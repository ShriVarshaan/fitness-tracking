import { type Rule } from "./types";

/** SLEEP_DEBT_HIGH: more than 5 hours of sleep debt over the last 7 nights. */
export const sleepDebtHigh: Rule = {
  id: "SLEEP_DEBT_HIGH",
  version: 1,
  evaluate(ctx) {
    const debt = ctx.sleepDebt.get(ctx.date);
    if (!debt || debt.debtS <= 5 * 3600) return null;
    return {
      ruleId: this.id,
      ruleVersion: this.version,
      severity: "caution",
      confidence: debt.confidence,
      evidence: [{ id: "sleep_debt_7d", metric: "sleep_debt", label: "Sleep debt this week", value: debt.debtS, unit: "s", window: "last 7 nights", source: "estimate" }],
    };
  },
};
