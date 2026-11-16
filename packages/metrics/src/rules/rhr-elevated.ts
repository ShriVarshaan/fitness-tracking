import { r1, type Rule } from "./types";
import { lastDates } from "./util";

/** RHR_ELEVATED: resting HR above baseline + max(5 bpm, 2 SD) on 3 consecutive days. Buchheit 2014. */
export const rhrElevated: Rule = {
  id: "RHR_ELEVATED",
  version: 1,
  evaluate(ctx) {
    const base = ctx.rhrBaseline.get(ctx.date);
    if (!base) return null;
    const values = lastDates(ctx, 3).map((d) => ctx.rhrDaily.get(d));
    if (values.some((v) => v === undefined)) return null;
    if (!values.every((v) => v! > base.elevatedAboveBpm)) return null;
    return {
      ruleId: this.id,
      ruleVersion: this.version,
      severity: "caution",
      confidence: base.confidence,
      evidence: [
        { id: "rhr_today", metric: "resting_hr", label: "Resting heart rate today", value: values[2]!, unit: "bpm", baseline: r1(base.baselineBpm), window: "today", source: "garmin" },
        { id: "rhr_threshold", metric: "resting_hr", label: "Raised above", value: r1(base.elevatedAboveBpm), unit: "bpm", window: "60-day baseline", source: "estimate" },
      ],
    };
  },
};
