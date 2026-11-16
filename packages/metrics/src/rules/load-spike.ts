import { type Rule } from "./types";

/** LOAD_SPIKE: acute:chronic ratio above 1.5. Descriptive only, never an injury prediction (Impellizzeri 2020). */
export const loadSpike: Rule = {
  id: "LOAD_SPIKE",
  version: 1,
  evaluate(ctx) {
    const ratio = ctx.acwr.get(ctx.date);
    if (ratio === undefined || ratio <= 1.5) return null;
    return {
      ruleId: this.id,
      ruleVersion: this.version,
      severity: "info",
      confidence: 1,
      evidence: [{ id: "acwr", metric: "acwr", label: "Load spike ratio", value: Math.round(ratio * 100) / 100, unit: "ratio", window: "7 vs 28 days", source: "estimate" }],
    };
  },
};
