import type { Evidence } from "@ft/metrics";
import { fmt, fmtBaseline } from "./format";
import type { Insight, InsightAction } from "./insight";

/** Within this many steps of the goal, a short walk is suggested. */
const STEP_GAP_FOR_WALK = 3000;

/**
 * Evening check-in written from evening evidence (packages/metrics/src/evening.ts)
 * with fixed templates: the day's activity, then tonight's sleep. Every number
 * in the text comes from the evidence.
 */
export function eveningInsight(forDate: string, evidence: Evidence[]): Insight {
  const by = new Map(evidence.map((e) => [e.id, e]));
  const body: string[] = [];
  const actions: InsightAction[] = [];
  const missingData: string[] = [];

  const steps = by.get("evening_steps");
  if (steps) {
    if (steps.baseline !== undefined) {
      body.push(
        steps.value >= steps.baseline
          ? `You've taken ${fmt(steps)} today, past your goal of ${fmtBaseline(steps)}.`
          : `You've taken ${fmt(steps)} today, against a goal of ${fmtBaseline(steps)}.`,
      );
      if (steps.value < steps.baseline && steps.baseline - steps.value <= STEP_GAP_FOR_WALK) {
        actions.push({ text: "A short walk this evening would close the gap on your step goal.", evidenceIds: ["evening_steps"] });
      }
    } else body.push(`You've taken ${fmt(steps)} today.`);
  } else missingData.push("Steps: no daily summary for today yet");

  const sessions = by.get("evening_sessions");
  const load = by.get("evening_load");
  if (sessions) body.push(`You trained today${load ? `, with a training load of ${fmt(load)}` : ""}.`);

  const intensity = by.get("evening_week_intensity");
  if (intensity) {
    body.push(
      intensity.value >= (intensity.baseline ?? Infinity)
        ? `This week you have ${fmt(intensity)} of activity so far, already past the WHO's ${fmtBaseline(intensity)} a week.`
        : `This week you have ${fmt(intensity)} of activity so far, towards the WHO's ${fmtBaseline(intensity)} a week.`,
    );
  }

  const debt = by.get("evening_sleep_debt");
  const bed = by.get("evening_bedtime");
  const wake = by.get("evening_usual_wake");
  const need = by.get("evening_sleep_need");
  const earlier = by.get("evening_earlier");
  if (debt && debt.value > 0) body.push(`Your sleep debt over the last 7 nights is ${fmt(debt)}.`);
  else if (debt) body.push("You have no sleep debt over the last 7 nights.");
  if (bed && wake && need) {
    body.push(`You usually wake around ${fmt(wake)}, so being asleep by ${fmt(bed)} gives you your ${fmt(need)} of sleep${earlier ? `, plus ${fmt(earlier)} towards your sleep debt` : ""}.`);
    actions.push({
      text: `Start winding down before ${fmt(bed)}: dim the lights and put screens away.`,
      evidenceIds: ["evening_bedtime", "evening_usual_wake", "evening_sleep_need"],
    });
  } else {
    missingData.push("Bedtime suggestion: needs wake times from at least 5 recent nights");
  }

  const headline = bed ? `Aim to be asleep by ${fmt(bed)}` : steps?.baseline !== undefined && steps.value >= steps.baseline ? "Step goal reached today" : "Your evening check-in";
  const confidence = bed && steps ? "high" : bed || steps ? "medium" : "low";
  return {
    kind: "evening",
    forDate,
    headline,
    body,
    actions,
    evidence: evidence.map((e) => ({ ...e, ruleId: "EVENING" })),
    confidence,
    missingData,
    redFlags: [],
    ruleIds: ["EVENING"],
    model: "template",
  };
}
