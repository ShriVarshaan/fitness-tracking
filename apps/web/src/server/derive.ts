import "server-only";
import { morningInsight, rewordInsight, rewordKey, validateInsight, type Insight } from "@ft/advice";
import { addDays, daysBetween } from "@ft/core";
import { schema, type Db } from "@ft/db";
import { aiModel, groqGenerate } from "./ai";
import { ALGO_VERSION, buildRuleContext, deriveAll, evaluateRules, type DeriveInputs, type DerivedRow } from "@ft/metrics";
import { and, asc, eq, gt, gte, inArray, lt, or, sql } from "drizzle-orm";

const { activities, activityStreams, dailySummaries, derivedDaily, findings, hrvDaily, insights, profile, sleepSessions } = schema;

const CHUNK = 500;
const DEFAULT_SLEEP_NEED_MIN = 480;
/** Rules are evaluated (and findings kept) for this many recent days. */
const FINDINGS_DAYS = 30;

/** Which algorithm produces each stored metric code. */
const METRIC_ALGO: Record<string, keyof typeof ALGO_VERSION> = {
  hrv_baseline: "hrv_baseline",
  rhr_baseline: "rhr_baseline",
  sleep_debt: "sleep_debt",
  trimp_daily: "trimp_edwards",
  ctl: "pmc",
  atl: "pmc",
  tsb: "pmc",
  acwr: "acwr",
  readiness: "readiness",
};

/**
 * Users who need a recompute without new data: no derived rows or insight yet
 * (first sync), or rows produced by an older algorithm version (a rollout).
 */
export async function usersMissingDerived(db: Db): Promise<string[]> {
  const current = sql.join(
    Object.entries(METRIC_ALGO).map(([code, algo]) => sql`(${code}, ${ALGO_VERSION[algo]}::smallint)`),
    sql`, `,
  );
  const rows = await db.execute<{ user_id: string }>(sql`
    select distinct d.user_id from daily_summaries d
    where not exists (select 1 from derived_daily x where x.user_id = d.user_id)
       or not exists (select 1 from insights i where i.user_id = d.user_id)
       or exists (
         select 1 from derived_daily x
         where x.user_id = d.user_id and (x.metric_code, x.algo_version) not in (${current})
       )
    limit 5`);
  return rows.map((r) => r.user_id);
}

type Inputs = DeriveInputs & { spo2Overnight: Array<{ date: string; value: number }> };

async function loadInputs(db: Db, userId: string): Promise<Inputs> {
  const [hrv, days, nights, acts, prof] = await Promise.all([
    db
      .select({ date: hrvDaily.localDate, value: hrvDaily.lastNightAvgMs })
      .from(hrvDaily)
      .where(eq(hrvDaily.userId, userId))
      .orderBy(asc(hrvDaily.localDate)),
    db
      .select({ date: dailySummaries.localDate, value: dailySummaries.restingHr })
      .from(dailySummaries)
      .where(eq(dailySummaries.userId, userId))
      .orderBy(asc(dailySummaries.localDate)),
    // If a wake date has more than one session, use the longest.
    db
      .select({
        date: sleepSessions.localDate,
        value: sql<number>`max(${sleepSessions.totalSleepS})`.mapWith(Number),
        spo2: sql<number | null>`avg(${sleepSessions.avgSpo2})`.mapWith((v) => (v === null ? null : Number(v))),
      })
      .from(sleepSessions)
      .where(eq(sleepSessions.userId, userId))
      .groupBy(sleepSessions.localDate),
    db
      .select({ date: activities.localDate, zoneSeconds: activities.hrZoneS, id: activities.sourceRecordId, source: activities.source })
      .from(activities)
      .where(eq(activities.userId, userId)),
    db.query.profile.findFirst({ columns: { sleepNeedMin: true }, where: eq(profile.userId, userId) }),
  ]);

  // Per-second HR and time from decoded activity files (for HR max and stream-based zones).
  const streamRows = await db
    .select({ id: activityStreams.sourceRecordId, source: activityStreams.source, stream: activityStreams.stream, values: activityStreams.values })
    .from(activityStreams)
    .where(and(eq(activityStreams.userId, userId), inArray(activityStreams.stream, ["hr", "time_s"])));
  const streams = new Map<string, { timeS?: number[]; hr?: Array<number | null> }>();
  for (const s of streamRows) {
    const key = `${s.source}:${s.id}`;
    const entry = streams.get(key) ?? {};
    if (s.stream === "hr") entry.hr = s.values as Array<number | null>;
    else entry.timeS = s.values;
    streams.set(key, entry);
  }

  const present = <T extends { value: number | null }>(rows: Array<T & { date: string }>) =>
    rows.filter((r): r is T & { date: string; value: number } => typeof r.value === "number").map((r) => ({ date: r.date, value: r.value }));

  return {
    hrv: present(hrv),
    rhr: present(days),
    sleep: present(nights),
    spo2Overnight: nights.flatMap((n) => (typeof n.spo2 === "number" ? [{ date: n.date, value: n.spo2 }] : [])),
    activities: acts.map((a) => {
      const s = streams.get(`${a.source}:${a.id}`);
      return { date: a.date, zoneSeconds: a.zoneSeconds, hrStream: s?.timeS && s.hr ? { timeS: s.timeS, hr: s.hr } : null };
    }),
    sleepNeedS: (prof?.sleepNeedMin ?? DEFAULT_SLEEP_NEED_MIN) * 60,
  };
}

async function storeDerived(db: Db, userId: string, rows: DerivedRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => ({ ...r, userId, computedAt: new Date() }));
    await db
      .insert(derivedDaily)
      .values(chunk)
      .onConflictDoUpdate({
        target: [derivedDaily.userId, derivedDaily.localDate, derivedDaily.metricCode],
        set: {
          value: sql`excluded.value`,
          components: sql`excluded.components`,
          confidence: sql`excluded.confidence`,
          algoVersion: sql`excluded.algo_version`,
          inputsHash: sql`excluded.inputs_hash`,
          computedAt: sql`excluded.computed_at`,
        },
        // Skip rows whose inputs and algorithm haven't changed.
        setWhere: sql`${derivedDaily.inputsHash} is distinct from excluded.inputs_hash`,
      });
  }
}

/** Evaluate rules for recent days, replace their findings, and write today's morning insight. */
async function storeFindingsAndInsight(db: Db, userId: string, inputs: Inputs, rows: DerivedRow[]): Promise<void> {
  const latest = rows.reduce<string | null>((max, r) => (max === null || r.localDate > max ? r.localDate : max), null);
  if (!latest) return;
  const from = addDays(latest, -(FINDINGS_DAYS - 1));
  const recentRows = rows.filter((r) => daysBetween(addDays(from, -60), r.localDate) >= 0);

  const perDay = Array.from({ length: FINDINGS_DAYS }, (_, i) => addDays(from, i)).map((date) => ({
    date,
    found: evaluateRules(buildRuleContext(date, inputs, recentRows)),
  }));

  await db.transaction(async (tx) => {
    await tx.delete(findings).where(and(eq(findings.userId, userId), gte(findings.localDate, from)));
    const values = perDay.flatMap(({ date, found }) =>
      found.map((f) => ({
        userId,
        localDate: date,
        ruleId: f.ruleId,
        ruleVersion: f.ruleVersion,
        severity: f.severity,
        confidence: f.confidence,
        evidence: f.evidence,
      })),
    );
    if (values.length) await tx.insert(findings).values(values);
  });

  const today = perDay.at(-1)!;
  const has = (list: Array<{ date: string }>) => list.some((p) => p.date === latest);
  const hrvToday = rows.find((r) => r.localDate === latest && r.metricCode === "hrv_baseline");
  const template = morningInsight(latest, today.found, {
    sleepLastNight: has(inputs.sleep),
    hrvLastNight: has(inputs.hrv),
    restingHrToday: has(inputs.rhr),
    baselineReason: hrvToday?.value === null ? String(hrvToday.components.reason ?? "") || null : null,
  });
  const { insight, rewordKey: key, fallback } = await maybeReword(db, userId, latest, template);
  const check = validateInsight(insight);

  await db
    .insert(insights)
    .values({
      userId,
      kind: "morning",
      forDate: latest,
      body: { ...insight, rewordKey: key, aiFallback: fallback } as unknown as Record<string, unknown>,
      ruleIds: insight.ruleIds,
      model: insight.model,
      validatorOk: check.ok,
    })
    .onConflictDoUpdate({
      target: [insights.userId, insights.kind, insights.forDate],
      set: { body: sql`excluded.body`, ruleIds: sql`excluded.rule_ids`, model: sql`excluded.model`, validatorOk: sql`excluded.validator_ok`, createdAt: sql`now()` },
    });
}

/**
 * Optional AI wording for users who opted in, when the server has a Groq key.
 * The same template (same rewordKey) is never sent twice: the stored wording is
 * reused, so frequent syncs don't spend the free quota.
 */
async function maybeReword(
  db: Db,
  userId: string,
  forDate: string,
  template: Insight,
): Promise<{ insight: Insight; rewordKey: string | null; fallback: string | null }> {
  const generate = groqGenerate();
  if (!generate) return { insight: template, rewordKey: null, fallback: null };
  const prof = await db.query.profile.findFirst({ columns: { aiEnabled: true }, where: eq(profile.userId, userId) });
  if (!prof?.aiEnabled) return { insight: template, rewordKey: null, fallback: null };

  const key = rewordKey(template);
  const existing = await db.query.insights.findFirst({
    columns: { body: true, model: true },
    where: and(eq(insights.userId, userId), eq(insights.kind, "morning"), eq(insights.forDate, forDate)),
  });
  if (existing && existing.body.rewordKey === key) {
    return {
      insight: existing.body as unknown as Insight,
      rewordKey: key,
      fallback: (existing.body.aiFallback as string | null) ?? null,
    };
  }

  const outcome = await rewordInsight(template, generate, aiModel());
  if (outcome.status === "template" && outcome.reason !== "red_flag" && outcome.reason !== "no_findings") {
    console.warn(`AI wording fell back to template (${outcome.reason}): ${outcome.detail ?? ""}`);
  }
  // A provider error (rate limit, timeout) is temporary: don't record the key, so the next sync retries.
  const transient = outcome.status === "template" && outcome.reason === "error";
  return {
    insight: outcome.insight,
    rewordKey: transient ? null : key,
    fallback: outcome.status === "template" ? outcome.reason : null,
  };
}

/**
 * Remove derived rows, findings and insights outside the new data range, e.g.
 * after demo data is removed or replaced by real data. With no data, removes all.
 */
async function dropStale(db: Db, userId: string, rows: DerivedRow[]): Promise<void> {
  const dates = rows.map((r) => r.localDate).sort();
  const first = dates[0];
  const last = dates.at(-1);
  await db.transaction(async (tx) => {
    if (!first || !last) {
      await tx.delete(derivedDaily).where(eq(derivedDaily.userId, userId));
      await tx.delete(findings).where(eq(findings.userId, userId));
      await tx.delete(insights).where(eq(insights.userId, userId));
      return;
    }
    await tx.delete(derivedDaily).where(and(eq(derivedDaily.userId, userId), or(lt(derivedDaily.localDate, first), gt(derivedDaily.localDate, last))));
    await tx.delete(findings).where(and(eq(findings.userId, userId), or(lt(findings.localDate, first), gt(findings.localDate, last))));
    await tx.delete(insights).where(and(eq(insights.userId, userId), gt(insights.forDate, last)));
  });
}

/** Recompute derived metrics, findings and the morning insight for one user. */
export async function recomputeDerived(db: Db, userId: string): Promise<number> {
  const inputs = await loadInputs(db, userId);
  const rows = deriveAll(inputs);
  await dropStale(db, userId, rows);
  await storeDerived(db, userId, rows);
  await storeFindingsAndInsight(db, userId, inputs, rows);
  return rows.length;
}
