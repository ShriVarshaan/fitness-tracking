import { type Rule } from "./types";

/** SLEEP_SHORT: last night more than 1 hour below sleep need. */
export const sleepShort: Rule = {
  id: "SLEEP_SHORT",
  version: 1,
  evaluate(ctx) {
    const actual = ctx.sleep.get(ctx.date);
    if (actual === undefined || actual >= ctx.sleepNeedS - 3600) return null;
    return {
      ruleId: this.id,
      ruleVersion: this.version,
      severity: "info",
      confidence: 1,
      evidence: [
        { id: "sleep_last_night", metric: "sleep_total", label: "Sleep last night", value: actual, unit: "s", baseline: ctx.sleepNeedS, baselineLabel: "need", window: "last night", source: "garmin" },
      ],
    };
  },
};
