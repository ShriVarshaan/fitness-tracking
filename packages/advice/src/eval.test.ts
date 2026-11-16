import { addDays } from "@ft/core";
import { evaluateRules, type RuleContext } from "@ft/metrics";
import { describe, expect, it } from "vitest";
import { morningInsight, RED_FLAG_TEXT, type Availability } from "./insight";
import { safetyViolations, ungroundedNumbers, validateInsight } from "./validate";

/**
 * Advice evaluation scenarios (docs/PLAN.md §10). Each synthetic day runs the
 * real rules and the template; hard checks must pass for every scenario.
 */
const D = "2026-06-10";
const NEED = 8 * 3600;
const dates = (n = 30) => Array.from({ length: n }, (_, i) => addDays(D, i - (n - 1)));

function healthy(): RuleContext {
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

const full: Availability = { sleepLastNight: true, hrvLastNight: true, restingHrToday: true };
const lowHrv = { rollingMs: 58, bandLowMs: 65, bandHighMs: 75, baselineMs: 70, confidence: 0.9 };

const SCENARIOS: Array<{ name: string; ctx: () => RuleContext; availability?: Availability; expectRules: string[]; expectRedFlag?: boolean }> = [
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

describe("advice evaluation scenarios", () => {
  for (const s of SCENARIOS) {
    describe(s.name, () => {
      const findings = evaluateRules(s.ctx());
      const insight = morningInsight(D, findings, s.availability ?? full);

      it("fires the expected rules", () => {
        expect(findings.map((f) => f.ruleId).sort()).toEqual([...s.expectRules].sort());
      });

      it("passes every hard check (grounding, citations, safety, missing data)", () => {
        expect(validateInsight(insight)).toMatchObject({ ok: true, ungrounded: [], uncited: [], unsafe: [] });
      });

      it("uses the fixed red-flag wording, and only for red flags", () => {
        if (s.expectRedFlag) {
          expect(insight.headline).toBe("Something to check");
          for (const rf of insight.redFlags) expect(rf.text).toBe(RED_FLAG_TEXT[rf.ruleId]);
          expect(insight.redFlags.map((r) => r.text).join(" ")).toMatch(/NHS 111/);
        } else {
          expect(insight.redFlags).toEqual([]);
        }
      });
    });
  }

  it("acknowledges missing data when confidence is low", () => {
    const s = SCENARIOS.find((x) => x.name.startsWith("new user"))!;
    const insight = morningInsight(D, evaluateRules(s.ctx()), s.availability!);
    expect(insight.confidence).toBe("low");
    expect(insight.missingData.length).toBeGreaterThan(0);
  });
});

describe("validators", () => {
  const insight = morningInsight(D, evaluateRules(healthy()), full);

  it("flags a number that isn't in the evidence", () => {
    expect(ungroundedNumbers("Your HRV is 91 ms today.", insight)).toEqual(["91"]);
    expect(ungroundedNumbers("Your HRV is 70 ms today.", insight)).toEqual([]);
  });

  it("blocks diagnosis and dosing language", () => {
    expect(safetyViolations("You may have an infection.")).not.toEqual([]);
    expect(safetyViolations("Take 400 mg of ibuprofen.")).not.toEqual([]);
    expect(safetyViolations("Consider an easier day.")).toEqual([]);
  });

  it("rejects an action with no evidence", () => {
    const bad = { ...insight, actions: [{ text: "Do something", evidenceIds: [] }] };
    expect(validateInsight(bad).uncited).toEqual(["Do something"]);
  });
});
