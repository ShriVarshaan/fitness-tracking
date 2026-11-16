import { type Rule } from "./types";

/** MISSING_OVERNIGHT_DATA: no sleep and no HRV recorded for last night (watch probably not worn). */
export const missingOvernight: Rule = {
  id: "MISSING_OVERNIGHT_DATA",
  version: 1,
  evaluate(ctx) {
    if (ctx.sleep.has(ctx.date) || ctx.hrvNightly.has(ctx.date)) return null;
    return { ruleId: this.id, ruleVersion: this.version, severity: "info", confidence: 1, evidence: [] };
  },
};
