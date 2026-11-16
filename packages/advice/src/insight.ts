import type { Evidence, Finding } from "@ft/metrics";
import { fmt, fmtBaseline } from "./format";

/**
 * Fixed red-flag wording (docs/PLAN.md §7). Never generated or reworded by an LLM.
 * It signposts; it does not interpret or diagnose.
 */
export const RED_FLAG_TEXT: Record<string, string> = {
  RHR_RED_FLAG:
    "Your resting heart rate has been well above your usual level for 3 days. This can happen with illness, stress, poor sleep or a sensor problem. If you feel unwell, contact your GP or call NHS 111. If you have chest pain, fainting or severe breathlessness, call 999.",
  SPO2_LOW_RED_FLAG:
    "Your watch recorded low overnight pulse ox on 3 or more of the last 7 nights. Wrist readings can be affected by fit and movement, so this is something to check, not a diagnosis. If you also feel breathless, very tired or unwell, contact your GP or call NHS 111. If you have severe breathlessness, call 999.",
};

export interface InsightAction {
  text: string;
  evidenceIds: string[];
}

export interface Insight {
  kind: "morning";
  forDate: string;
  headline: string;
  body: string[];
  actions: InsightAction[];
  /** Every number the text relies on, shown as "Based on…" chips. */
  evidence: Array<Evidence & { ruleId: string }>;
  confidence: "high" | "medium" | "low";
  /** Plain-language list of what wasn't available. */
  missingData: string[];
  redFlags: Array<{ ruleId: string; text: string }>;
  ruleIds: string[];
  model: "template";
}

export interface Availability {
  sleepLastNight: boolean;
  hrvLastNight: boolean;
  restingHrToday: boolean;
  /** Reason the HRV/RHR baselines aren't available yet, if any. */
  baselineReason?: string | null;
}

type Wording = (f: Finding, ev: (id: string) => Evidence) => { headline: string; sentence: string; action?: InsightAction };

const WORDING: Record<string, Wording> = {
  HRV_BELOW_NORMAL: (_f, ev) => ({
    headline: "Your HRV is below its usual range",
    sentence: `Your 7-night HRV average is ${fmt(ev("hrv_7d"))}, under the bottom of your usual range (${fmt(ev("hrv_band_low"))}) for a second day.`,
    action: { text: "Consider keeping today's training easy and prioritising sleep.", evidenceIds: ["hrv_7d", "hrv_band_low"] },
  }),
  RHR_ELEVATED: (_f, ev) => ({
    headline: "Your resting heart rate is raised",
    sentence: `Your resting heart rate is ${fmt(ev("rhr_today"))}, above ${fmt(ev("rhr_threshold"))} for 3 days running (your baseline is ${fmtBaseline(ev("rhr_today"))}).`,
    action: { text: "A lighter day may help. Note how you feel; illness, stress, alcohol and heat can all raise it.", evidenceIds: ["rhr_today", "rhr_threshold"] },
  }),
  SLEEP_DEBT_HIGH: (_f, ev) => ({
    headline: "You're short on sleep this week",
    sentence: `Over the last 7 nights you've slept ${fmt(ev("sleep_debt_7d"))} less than you need.`,
    action: { text: "An earlier night or two would help pay this back.", evidenceIds: ["sleep_debt_7d"] },
  }),
  SLEEP_SHORT: (_f, ev) => ({
    headline: "Short night",
    sentence: `You slept ${fmt(ev("sleep_last_night"))} last night, against a need of ${fmtBaseline(ev("sleep_last_night"))}.`,
    action: { text: "Aim for an earlier bedtime tonight.", evidenceIds: ["sleep_last_night"] },
  }),
  LOAD_SPIKE: (_f, ev) => ({
    headline: "Your training load has jumped",
    sentence: `Your recent load is well above your usual level (load spike ratio ${fmt(ev("acwr"))}; 0.8–1.3 is typical).`,
    action: { text: "If you're building up on purpose, build in an easier day soon.", evidenceIds: ["acwr"] },
  }),
  DETRAINING: (_f, ev) => ({
    headline: "Your fitness is drifting down",
    sentence: `Your fitness estimate is ${fmt(ev("ctl_now"))}, down from ${fmtBaseline(ev("ctl_now"))} three weeks ago.`,
    action: { text: "A couple of sessions this week would hold it steady.", evidenceIds: ["ctl_now"] },
  }),
  MISSING_OVERNIGHT_DATA: () => ({
    headline: "No overnight data",
    sentence: "There's no sleep or HRV recorded for last night, so recovery can't be judged today. Was the watch worn?",
  }),
  RECOVERY_NORMAL: (_f, ev) => ({
    headline: "You look recovered",
    sentence: `Your 7-night HRV average (${fmt(ev("hrv_7d"))}) and today's resting heart rate (${fmt(ev("rhr_today"))}) are within your usual ranges, and you slept ${fmt(ev("sleep_last_night"))}.`,
    action: { text: "A normal or harder training day looks reasonable if you feel good.", evidenceIds: ["hrv_7d", "rhr_today", "sleep_last_night"] },
  }),
};

function confidenceLevel(findings: Finding[]): Insight["confidence"] {
  const relevant = findings.filter((f) => f.evidence.length > 0);
  if (relevant.length === 0) return "low";
  const c = Math.min(...relevant.map((f) => f.confidence));
  return c >= 0.75 ? "high" : c >= 0.4 ? "medium" : "low";
}

/**
 * Morning insight written from findings with fixed templates. Always available,
 * no LLM. Every number in the text comes from finding evidence.
 */
export function morningInsight(forDate: string, findings: Finding[], availability: Availability): Insight {
  const missingData: string[] = [];
  if (!availability.sleepLastNight) missingData.push("Sleep: nothing recorded for last night");
  if (!availability.hrvLastNight) missingData.push("HRV: no overnight reading");
  if (!availability.restingHrToday) missingData.push("Resting heart rate: not recorded today");
  if (availability.baselineReason) missingData.push(`Baselines: ${availability.baselineReason}`);

  const redFlags = findings
    .filter((f) => f.severity === "red_flag")
    .map((f) => ({ ruleId: f.ruleId, text: RED_FLAG_TEXT[f.ruleId] ?? "Something in your data is worth checking with your GP or NHS 111." }));

  const worded = findings
    .filter((f) => f.severity !== "red_flag" && WORDING[f.ruleId])
    .map((f) => {
      const byId = new Map(f.evidence.map((e) => [e.id, e]));
      const ev = (id: string) => {
        const e = byId.get(id);
        if (!e) throw new Error(`${f.ruleId}: missing evidence ${id}`);
        return e;
      };
      return { f, ...WORDING[f.ruleId]!(f, ev) };
    });

  const headline =
    redFlags.length > 0 ? "Something to check" : (worded[0]?.headline ?? (missingData.length ? "Not enough data for a full picture" : "Nothing stands out today"));

  const body = worded.map((w) => w.sentence);
  if (body.length === 0 && redFlags.length === 0) {
    body.push("Nothing in your recent sleep, HRV or resting heart rate stands out.");
  }

  return {
    kind: "morning",
    forDate,
    headline,
    body,
    actions: worded.flatMap((w) => (w.action ? [w.action] : [])),
    evidence: findings.flatMap((f) => f.evidence.map((e) => ({ ...e, ruleId: f.ruleId }))),
    confidence: confidenceLevel(findings),
    missingData,
    redFlags,
    ruleIds: findings.map((f) => f.ruleId),
    model: "template",
  };
}
