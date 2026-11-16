import type { Evidence } from "@ft/metrics";
import { duration, fmt, fmtBaseline } from "./format";
import type { Insight, InsightAction } from "./insight";

/**
 * Weekly summary written from weekly evidence (packages/metrics/src/weekly.ts)
 * with fixed templates. Every number in the text comes from the evidence.
 */
export function weeklyInsight(
  forDate: string,
  evidence: Evidence[],
  opts: { complete: boolean; daysElapsed: number; sleepNights: number },
): Insight {
  const by = new Map(evidence.map((e) => [e.id, e]));
  const body: string[] = [];
  const actions: InsightAction[] = [];
  const missingData: string[] = [];

  const sessions = by.get("week_sessions");
  const time = by.get("week_training_time");
  const load = by.get("week_load");
  if (sessions && sessions.value > 0) {
    let s = `You trained ${fmt(sessions).replace(/ sessions?$/, sessions.value === 1 ? " time" : " times")}`;
    if (time) s += ` for ${fmt(time)}`;
    if (load) s += `, a training load of ${fmt(load)}`;
    if (load?.baseline !== undefined) s += ` (${fmtBaseline(load)} the week before)`;
    body.push(`${s}.`);
    if (load && load.baseline !== undefined && load.baseline > 0 && load.value > load.baseline * 1.5 && opts.complete) {
      actions.push({ text: "Your load rose a lot on the week before; an easier week next would help you absorb it.", evidenceIds: ["week_load"] });
    }
  } else if (sessions) {
    body.push(opts.complete ? "No training was recorded this week." : "No training recorded so far this week.");
  }

  const sleep = by.get("week_sleep_avg");
  if (sleep && sleep.baseline !== undefined) {
    body.push(`You averaged ${fmt(sleep)} of sleep a night, against a need of ${fmtBaseline(sleep)}.`);
    if (sleep.value < sleep.baseline - 1800) {
      actions.push({
        text: opts.complete
          ? "Protecting your sleep next week is the easiest win: aim for a consistent, earlier bedtime."
          : "Earlier, more consistent bedtimes for the rest of the week would help close the gap.",
        evidenceIds: ["week_sleep_avg"],
      });
    }
  } else {
    missingData.push("Sleep: no nights recorded this week");
  }
  if (opts.sleepNights > 0 && opts.sleepNights < opts.daysElapsed - 1) {
    missingData.push(`Sleep: only ${opts.sleepNights} of ${opts.daysElapsed} nights recorded`);
  }

  const hrv = by.get("week_hrv_avg");
  const rhr = by.get("week_rhr_avg");
  if (hrv) body.push(`Average overnight HRV was ${fmt(hrv)}${hrv.baseline !== undefined ? ` (${fmtBaseline(hrv)} the week before)` : ""}.`);
  else missingData.push("HRV: no overnight readings this week");
  if (rhr) body.push(`Resting heart rate averaged ${fmt(rhr)}${rhr.baseline !== undefined ? ` (${fmtBaseline(rhr)} the week before)` : ""}.`);

  const intensity = by.get("week_intensity");
  if (intensity && intensity.baseline !== undefined) {
    body.push(`You logged ${Math.round(intensity.value)} intensity minutes; the WHO guideline is ${intensity.baseline} a week.`);
    if (opts.complete && intensity.value < intensity.baseline) {
      actions.push({ text: "A few brisk walks or easy sessions would reach the weekly guideline.", evidenceIds: ["week_intensity"] });
    }
  }
  const steps = by.get("week_steps_avg");
  if (steps) body.push(`Steps averaged ${fmt(steps).replace(" steps", "")} a day.`);

  const headline = opts.complete
    ? sessions && sessions.value > 0
      ? `Your week: ${fmt(sessions)}${sleep ? `, ${duration(sleep.value)} average sleep` : ""}`
      : "Your week in review"
    : "This week so far";

  const confidence: Insight["confidence"] = !opts.complete ? "medium" : opts.sleepNights >= 5 ? "high" : opts.sleepNights >= 3 ? "medium" : "low";
  if (!opts.complete) missingData.push(`Week in progress: ${opts.daysElapsed} of 7 days so far`);

  return {
    kind: "weekly",
    forDate,
    headline,
    body,
    actions,
    evidence: evidence.map((e) => ({ ...e, ruleId: "WEEKLY_SUMMARY" })),
    confidence,
    missingData,
    redFlags: [],
    ruleIds: ["WEEKLY_SUMMARY"],
    model: "template",
  };
}
