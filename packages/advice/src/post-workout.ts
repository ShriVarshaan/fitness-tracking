import type { Evidence, Finding } from "@ft/metrics";
import { duration, fmt, fmtBaseline } from "./format";
import { RED_FLAG_TEXT, type Insight, type InsightAction } from "./insight";

/** Session load at or above this multiple of your typical session counts as a big session. */
export const BIG_SESSION_RATIO = 1.5;
/** At or below this multiple it counts as an easy one. */
export const EASY_SESSION_RATIO = 0.6;
/** Above this multiple, training on a low-recovery day earns a nudge. */
const HARDER_THAN_USUAL_RATIO = 1.2;

export interface PostWorkoutContext {
  /** The activity's source id, for linking; null if it has none. */
  activityId: string | null;
  /** Readable sport name, e.g. "Running". */
  sport: string;
  /** Findings for the session's day (from the morning rules). */
  dayFindings: Finding[];
}

/**
 * Post-workout summary written from session evidence (packages/metrics/src/session.ts)
 * with fixed templates. Every number in the text comes from the evidence.
 */
export function postWorkoutInsight(forDate: string, evidence: Evidence[], ctx: PostWorkoutContext): Insight {
  const by = new Map(evidence.map((e) => [e.id, e]));
  const sport = ctx.sport.toLowerCase();
  const body: string[] = [];
  const actions: InsightAction[] = [];
  const missingData: string[] = [];
  const extraEvidence: Array<Evidence & { ruleId: string }> = [];
  const ruleIds = ["POST_WORKOUT"];

  const dur = by.get("session_duration");
  const dist = by.get("session_distance");
  const hr = by.get("session_avg_hr");
  let first = `You did ${dur ? `${fmt(dur)} of ${sport}` : `a ${sport} session`}`;
  if (dist) first += `, covering ${fmt(dist)}`;
  if (hr) first += `, at an average heart rate of ${fmt(hr)}`;
  body.push(`${first}.`);

  const load = by.get("session_load");
  const ratio = load && load.baseline !== undefined && load.baseline > 0 ? load.value / load.baseline : null;
  const size = ratio === null ? null : ratio >= BIG_SESSION_RATIO ? "big" : ratio <= EASY_SESSION_RATIO ? "easy" : "typical";
  if (load && ratio !== null) {
    const compare =
      size === "big"
        ? `well above your typical ${sport} session`
        : size === "easy"
          ? `well below your typical ${sport} session`
          : `close to your typical ${sport} session`;
    body.push(`Its training load was ${fmt(load)}, ${compare} (${fmtBaseline(load)}).`);
    if (size === "big") {
      actions.push({ text: "Make tomorrow easier and protect your sleep tonight, so your body can absorb it.", evidenceIds: ["session_load"] });
    }
  } else if (load) {
    body.push(`Its training load was ${fmt(load)}.`);
    missingData.push(`Comparison: fewer than 3 earlier ${sport} sessions with heart rate in the last 4 weeks`);
  } else {
    missingData.push("Training load: no heart-rate data for this session");
  }

  const te = by.get("session_aerobic_te");
  if (te) body.push(`Garmin rated its aerobic training effect ${fmt(te)}.`);
  const rpe = by.get("session_rpe");
  if (rpe) body.push(`You rated the effort ${fmt(rpe)}.`);

  // Training harder than usual on a day the morning markers were low.
  const low = ctx.dayFindings.filter((f) => f.ruleId === "HRV_BELOW_NORMAL" || f.ruleId === "RHR_ELEVATED");
  if (low.length > 0 && ratio !== null && ratio > HARDER_THAN_USUAL_RATIO) {
    const marker = (id: string) => low.flatMap((f) => f.evidence.filter((e) => e.id === id).map((e) => ({ ...e, ruleId: f.ruleId })))[0];
    const hrv = marker("hrv_7d");
    const rhr = marker("rhr_today");
    const parts = [hrv && `your 7-night HRV average was ${fmt(hrv)}, below its usual range`, rhr && `your resting heart rate was raised at ${fmt(rhr)}`].filter(
      Boolean,
    );
    if (parts.length > 0) {
      body.push(`This came on a day when ${parts.join(" and ")}.`);
      for (const e of [hrv, rhr]) if (e) extraEvidence.push(e);
      ruleIds.push(...new Set(extraEvidence.map((e) => e.ruleId)));
      actions.push({
        text: "Keep the next day or two light and see how your morning numbers respond.",
        evidenceIds: ["session_load", ...extraEvidence.map((e) => e.id)],
      });
    }
  }

  const redFlags = ctx.dayFindings
    .filter((f) => f.severity === "red_flag")
    .map((f) => ({ ruleId: f.ruleId, text: RED_FLAG_TEXT[f.ruleId] ?? "Something in your data is worth checking with your GP or NHS 111." }));

  const label = ctx.sport.charAt(0).toUpperCase() + ctx.sport.slice(1);
  const headline =
    redFlags.length > 0
      ? "Something to check"
      : size === "big"
        ? `A big ${sport} session`
        : size === "easy"
          ? `An easy ${sport} session`
          : size === "typical"
            ? `A typical ${sport} session`
            : dur
              ? `${label}: ${duration(dur.value)}`
              : label;

  return {
    kind: "post_workout",
    forDate,
    headline,
    body,
    actions,
    evidence: [...evidence.map((e) => ({ ...e, ruleId: "POST_WORKOUT" })), ...extraEvidence],
    confidence: ratio !== null ? "high" : load ? "medium" : "low",
    missingData,
    redFlags,
    ruleIds: [...ruleIds, ...redFlags.map((r) => r.ruleId)],
    model: "template",
    ...(ctx.activityId ? { activityId: ctx.activityId } : {}),
  };
}
