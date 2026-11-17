import { addDays } from "@ft/core";
import type { RuleContext } from "@ft/metrics";
import type { Availability } from "./insight";

/**
 * Advice evaluation scenarios (docs/PLAN.md §10), shared by the template
 * suite (eval.test.ts) and the live model check (test/live). Each is a
 * synthetic day the real rules run on.
 */
export const D = "2026-06-10";
const NEED = 8 * 3600;
const dates = (n = 30) => Array.from({ length: n }, (_, i) => addDays(D, i - (n - 1)));

export function healthy(): RuleContext {
  const ds = dates();
  return {
    date: D,
    sleepNeedS: NEED,
    hrvNightly: new Map(ds.map((d) => [d, 70])),
    hrvBaseline: new Map(ds.map((d) => [d, { rollingMs: 70, bandLowMs: 65, bandHighMs: 75, baselineMs: 70, confidence: 1 }])),
    rhrDaily: new Map(ds.map((d) => [d, 50])),
    rhrBaseline: new Map(ds.map((d) => [d, { baselineBpm: 50, elevatedAboveBpm: 55, confidence: 1 }])),
    sleep: new Map(ds.map((d) => [d, NEED])),
    spo2Overnight: new Map(ds.map((d) => [d, 96])),
    sleepDebt: new Map(ds.map((d) => [d, { debtS: 0, confidence: 1 }])),
    acwr: new Map(ds.map((d) => [d, 1])),
    ctl: new Map(ds.map((d) => [d, 30])),
  };
}

export const full: Availability = { sleepLastNight: true, hrvLastNight: true, restingHrToday: true };
const lowHrv = { rollingMs: 58, bandLowMs: 65, bandHighMs: 75, baselineMs: 70, confidence: 0.9 };

export const SCENARIOS: Array<{ name: string; ctx: () => RuleContext; availability?: Availability; expectRules: string[]; expectRedFlag?: boolean }> = [
  { name: "recovered", ctx: healthy, expectRules: ["RECOVERY_NORMAL"] },
  {
    name: "poor sleep and low HRV",
    ctx: () => {
      const c = healthy();
      c.hrvBaseline.set(addDays(D, -1), lowHrv);
      c.hrvBaseline.set(D, lowHrv);
      c.sleep.set(D, 5 * 3600);
      c.sleepDebt.set(D, { debtS: 6 * 3600, confidence: 1 });
      return c;
    },
    expectRules: ["HRV_BELOW_NORMAL", "SLEEP_DEBT_HIGH", "SLEEP_SHORT"],
  },
  {
    name: "load spike",
    ctx: () => {
      const c = healthy();
      c.acwr.set(D, 1.74);
      return c;
    },
    expectRules: ["LOAD_SPIKE", "RECOVERY_NORMAL"],
  },
  {
    name: "illness-like resting HR rise",
    ctx: () => {
      const c = healthy();
      for (const d of [addDays(D, -2), addDays(D, -1), D]) c.rhrDaily.set(d, 63);
      return c;
    },
    expectRules: ["RHR_RED_FLAG", "RHR_ELEVATED"],
    expectRedFlag: true,
  },
  {
    name: "low overnight pulse ox",
    ctx: () => {
      const c = healthy();
      for (const d of [addDays(D, -5), addDays(D, -2), D]) c.spo2Overnight.set(d, 88);
      return c;
    },
    expectRules: ["SPO2_LOW_RED_FLAG", "RECOVERY_NORMAL"],
    expectRedFlag: true,
  },
  {
    name: "watch not worn last night",
    ctx: () => {
      const c = healthy();
      c.sleep.delete(D);
      c.hrvNightly.delete(D);
      return c;
    },
    availability: { sleepLastNight: false, hrvLastNight: false, restingHrToday: true },
    expectRules: ["MISSING_OVERNIGHT_DATA"],
  },
  {
    name: "new user with under 14 days of data",
    ctx: () => ({ ...healthy(), hrvBaseline: new Map(), rhrBaseline: new Map(), sleepDebt: new Map(), acwr: new Map(), ctl: new Map() }),
    availability: { ...full, baselineReason: "needs 14 nights of HRV in the last 60 days; has 6" },
    expectRules: [],
  },
  {
    name: "detraining",
    ctx: () => {
      const c = healthy();
      c.ctl.set(addDays(D, -21), 40);
      c.ctl.set(D, 28);
      return c;
    },
    expectRules: ["RECOVERY_NORMAL", "DETRAINING"],
  },
];
