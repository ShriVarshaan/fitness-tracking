import { addDays } from "@ft/core";
import { r1, type Rule } from "./types";

/** DETRAINING: fitness (CTL) down by more than 20% over 21 days, from a meaningful level (≥ 10). */
export const detraining: Rule = {
  id: "DETRAINING",
  version: 1,
  evaluate(ctx) {
    const now = ctx.ctl.get(ctx.date);
    const before = ctx.ctl.get(addDays(ctx.date, -21));
    if (now === undefined || before === undefined || before < 10 || now >= before * 0.8) return null;
    return {
      ruleId: this.id,
      ruleVersion: this.version,
      severity: "info",
      confidence: 1,
      evidence: [
        { id: "ctl_now", metric: "ctl", label: "Fitness now", value: r1(now), unit: "load", baseline: r1(before), window: "vs 3 weeks ago", source: "estimate" },
      ],
    };
  },
};
