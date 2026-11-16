import { r1, type Rule } from "./types";

/** RECOVERY_NORMAL: HRV within its usual range, resting HR not raised, slept at least the need. */
export const recoveryNormal: Rule = {
  id: "RECOVERY_NORMAL",
  version: 1,
  evaluate(ctx) {
    const hrv = ctx.hrvBaseline.get(ctx.date);
    const rhrBase = ctx.rhrBaseline.get(ctx.date);
    const rhr = ctx.rhrDaily.get(ctx.date);
    const sleep = ctx.sleep.get(ctx.date);
    if (!hrv || !rhrBase || rhr === undefined || sleep === undefined) return null;
    if (hrv.rollingMs < hrv.bandLowMs || rhr > rhrBase.elevatedAboveBpm || sleep < ctx.sleepNeedS - 1800) return null;
    return {
      ruleId: this.id,
      ruleVersion: this.version,
      severity: "info",
      confidence: Math.min(hrv.confidence, rhrBase.confidence),
      evidence: [
        { id: "hrv_7d", metric: "hrv_rmssd_ms", label: "HRV, 7-night average", value: r1(hrv.rollingMs), unit: "ms", baseline: r1(hrv.baselineMs), window: "7-night average", source: "estimate" },
        { id: "rhr_today", metric: "resting_hr", label: "Resting heart rate today", value: rhr, unit: "bpm", baseline: r1(rhrBase.baselineBpm), window: "today", source: "garmin" },
        { id: "sleep_last_night", metric: "sleep_total", label: "Sleep last night", value: sleep, unit: "s", baseline: ctx.sleepNeedS, window: "last night", source: "garmin" },
      ],
    };
  },
};
