import { r1, type Rule } from "./types";
import { lastDates } from "./util";

/**
 * RHR_RED_FLAG: resting HR > baseline + 10 bpm, or > 100 bpm, on 3 consecutive days.
 * Signposting only (docs/PLAN.md §7); never interpreted.
 */
export const rhrRedFlag: Rule = {
  id: "RHR_RED_FLAG",
  version: 1,
  evaluate(ctx) {
    const base = ctx.rhrBaseline.get(ctx.date);
    const values = lastDates(ctx, 3).map((d) => ctx.rhrDaily.get(d));
    if (values.some((v) => v === undefined)) return null;
    const over100 = values.every((v) => v! > 100);
    const overBaseline = base ? values.every((v) => v! > base.baselineBpm + 10) : false;
    if (!over100 && !overBaseline) return null;
    return {
      ruleId: this.id,
      ruleVersion: this.version,
      severity: "red_flag",
      confidence: base?.confidence ?? 1,
      evidence: [
        { id: "rhr_today", metric: "resting_hr", label: "Resting heart rate today", value: values[2]!, unit: "bpm", ...(base ? { baseline: r1(base.baselineBpm) } : {}), window: "3 days running", source: "garmin" },
      ],
    };
  },
};
