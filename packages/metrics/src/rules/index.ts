import type { Finding, RuleContext } from "./types";
import { hrvBelowNormal } from "./hrv-below-normal";
import { rhrElevated } from "./rhr-elevated";
import { rhrRedFlag } from "./rhr-red-flag";
import { spo2LowRedFlag } from "./spo2-low-red-flag";
import { sleepShort } from "./sleep-short";
import { sleepDebtHigh } from "./sleep-debt-high";
import { loadSpike } from "./load-spike";
import { detraining } from "./detraining";
import { missingOvernight } from "./missing-overnight";
import { recoveryNormal } from "./recovery-normal";

export * from "./types";

export const RULES = [
  rhrRedFlag,
  spo2LowRedFlag,
  hrvBelowNormal,
  rhrElevated,
  sleepDebtHigh,
  sleepShort,
  loadSpike,
  detraining,
  missingOvernight,
  recoveryNormal,
];

/** Run every rule for ctx.date. Red flags first, then cautions, then info. */
export function evaluateRules(ctx: RuleContext): Finding[] {
  const order = { red_flag: 0, caution: 1, info: 2 } as const;
  return RULES.map((r) => r.evaluate(ctx))
    .filter((f): f is Finding => f !== null)
    .sort((a, b) => order[a.severity] - order[b.severity]);
}
