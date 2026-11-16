import "server-only";
import { schema, type Db } from "@ft/db";
import { deriveAll } from "@ft/metrics";
import { asc, eq, sql } from "drizzle-orm";

const { activities, dailySummaries, derivedDaily, hrvDaily, profile, sleepSessions } = schema;

const CHUNK = 500;
const DEFAULT_SLEEP_NEED_MIN = 480;

/** Users with Garmin data but no derived rows yet (e.g. first sync, or a new metric version rollout). */
export async function usersMissingDerived(db: Db): Promise<string[]> {
  const rows = await db.execute<{ user_id: string }>(sql`
    select distinct d.user_id from daily_summaries d
    where not exists (select 1 from derived_daily x where x.user_id = d.user_id)
    limit 5`);
  return rows.map((r) => r.user_id);
}

/** Recompute every derived metric for one user from their stored data. */
export async function recomputeDerived(db: Db, userId: string): Promise<number> {
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
      .select({ date: sleepSessions.localDate, value: sql<number>`max(${sleepSessions.totalSleepS})`.mapWith(Number) })
      .from(sleepSessions)
      .where(eq(sleepSessions.userId, userId))
      .groupBy(sleepSessions.localDate),
    db
      .select({ date: activities.localDate, zoneSeconds: activities.hrZoneS })
      .from(activities)
      .where(eq(activities.userId, userId)),
    db.query.profile.findFirst({ columns: { sleepNeedMin: true }, where: eq(profile.userId, userId) }),
  ]);

  const present = <T extends { value: number | null }>(rows: Array<T & { date: string }>) =>
    rows.filter((r): r is T & { date: string; value: number } => typeof r.value === "number");

  const rows = deriveAll({
    hrv: present(hrv),
    rhr: present(days),
    sleep: present(nights),
    activities: acts,
    sleepNeedS: (prof?.sleepNeedMin ?? DEFAULT_SLEEP_NEED_MIN) * 60,
  });

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
  return rows.length;
}
