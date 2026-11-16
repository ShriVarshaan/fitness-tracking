import { addDays } from "@ft/core";
import { describe, expect, it } from "vitest";
import { detraining } from "./detraining";
import { hrvBelowNormal } from "./hrv-below-normal";
import { evaluateRules } from "./index";
import { loadSpike } from "./load-spike";
import { missingOvernight } from "./missing-overnight";
import { recoveryNormal } from "./recovery-normal";
import { rhrElevated } from "./rhr-elevated";
import { rhrRedFlag } from "./rhr-red-flag";
import { sleepDebtHigh } from "./sleep-debt-high";
import { sleepShort } from "./sleep-short";
import { spo2LowRedFlag } from "./spo2-low-red-flag";
import type { RuleContext } from "./types";

const D = "2026-06-10";
const prev = (n: number) => addDays(D, -n);
const NEED = 8 * 3600;

/** A healthy, fully-populated context; tests override one thing at a time. */
function ctx(over: Partial<RuleContext> = {}): RuleContext {
  const dates = Array.from({ length: 30 }, (_, i) => prev(29 - i));
  return {
    date: D,
    sleepNeedS: NEED,
    hrvNightly: new Map(dates.map((d) => [d, 70])),
    hrvBaseline: new Map(dates.map((d) => [d, { rollingMs: 70, bandLowMs: 65, bandHighMs: 75, baselineMs: 70, confidence: 1 }])),
    rhrDaily: new Map(dates.map((d) => [d, 50])),
    rhrBaseline: new Map(dates.map((d) => [d, { baselineBpm: 50, elevatedAboveBpm: 55, confidence: 1 }])),
    sleep: new Map(dates.map((d) => [d, NEED])),
    spo2Overnight: new Map(dates.map((d) => [d, 96])),
    sleepDebt: new Map(dates.map((d) => [d, { debtS: 0, confidence: 1 }])),
    acwr: new Map(dates.map((d) => [d, 1])),
    ctl: new Map(dates.map((d) => [d, 30])),
    ...over,
  };
}

const withDays = <V>(base: Map<string, V>, entries: Array<[string, V]>) => new Map([...base, ...entries]);

describe("HRV_BELOW_NORMAL", () => {
  const low = { rollingMs: 60, bandLowMs: 65, bandHighMs: 75, baselineMs: 70, confidence: 0.8 };
  it("fires after two days below the usual range", () => {
    const c = ctx();
    const f = hrvBelowNormal.evaluate(ctx({ hrvBaseline: withDays(c.hrvBaseline, [[prev(1), low], [D, low]]) }));
    expect(f).toMatchObject({ severity: "caution", confidence: 0.8 });
    expect(f?.evidence.map((e) => e.id)).toEqual(["hrv_7d", "hrv_band_low"]);
  });
  it("does not fire after one low day", () => {
    const c = ctx();
    expect(hrvBelowNormal.evaluate(ctx({ hrvBaseline: withDays(c.hrvBaseline, [[D, low]]) }))).toBeNull();
  });
  it("does not fire without a baseline", () => {
    expect(hrvBelowNormal.evaluate(ctx({ hrvBaseline: new Map() }))).toBeNull();
  });
});

describe("RHR_ELEVATED", () => {
  it("fires after three days above the threshold", () => {
    const c = ctx();
    const f = rhrElevated.evaluate(ctx({ rhrDaily: withDays(c.rhrDaily, [[prev(2), 57], [prev(1), 58], [D, 57]]) }));
    expect(f?.evidence[0]).toMatchObject({ id: "rhr_today", value: 57, baseline: 50 });
  });
  it("does not fire after two days", () => {
    const c = ctx();
    expect(rhrElevated.evaluate(ctx({ rhrDaily: withDays(c.rhrDaily, [[prev(1), 58], [D, 57]]) }))).toBeNull();
  });
  it("does not fire with a missing day", () => {
    const c = ctx();
    const rhr = withDays(c.rhrDaily, [[prev(2), 57], [D, 57]]);
    rhr.delete(prev(1));
    expect(rhrElevated.evaluate(ctx({ rhrDaily: rhr }))).toBeNull();
  });
});

describe("RHR_RED_FLAG", () => {
  it("fires at baseline + 10 bpm for three days", () => {
    const c = ctx();
    const f = rhrRedFlag.evaluate(ctx({ rhrDaily: withDays(c.rhrDaily, [[prev(2), 61], [prev(1), 62], [D, 61]]) }));
    expect(f?.severity).toBe("red_flag");
  });
  it("fires above 100 bpm even without a baseline", () => {
    const c = ctx();
    const f = rhrRedFlag.evaluate(
      ctx({ rhrBaseline: new Map(), rhrDaily: withDays(c.rhrDaily, [[prev(2), 101], [prev(1), 102], [D, 101]]) }),
    );
    expect(f?.severity).toBe("red_flag");
  });
  it("does not fire at baseline + 9", () => {
    const c = ctx();
    expect(rhrRedFlag.evaluate(ctx({ rhrDaily: withDays(c.rhrDaily, [[prev(2), 59], [prev(1), 59], [D, 59]]) }))).toBeNull();
  });
});

describe("SPO2_LOW_RED_FLAG", () => {
  it("fires on three low nights in seven", () => {
    const c = ctx();
    const f = spo2LowRedFlag.evaluate(ctx({ spo2Overnight: withDays(c.spo2Overnight, [[prev(6), 89], [prev(3), 88], [D, 89.5]]) }));
    expect(f?.evidence).toMatchObject([{ value: 3 }, { value: 88 }]);
  });
  it("does not fire on two low nights", () => {
    const c = ctx();
    expect(spo2LowRedFlag.evaluate(ctx({ spo2Overnight: withDays(c.spo2Overnight, [[prev(3), 88], [D, 89]]) }))).toBeNull();
  });
  it("does not fire with no readings", () => {
    expect(spo2LowRedFlag.evaluate(ctx({ spo2Overnight: new Map() }))).toBeNull();
  });
});

describe("SLEEP_SHORT", () => {
  it("fires more than an hour under need", () => {
    const c = ctx();
    expect(sleepShort.evaluate(ctx({ sleep: withDays(c.sleep, [[D, NEED - 3601]]) }))?.evidence[0]?.value).toBe(NEED - 3601);
  });
  it("does not fire within the hour", () => {
    const c = ctx();
    expect(sleepShort.evaluate(ctx({ sleep: withDays(c.sleep, [[D, NEED - 3600]]) }))).toBeNull();
  });
  it("does not fire with no record", () => {
    expect(sleepShort.evaluate(ctx({ sleep: new Map() }))).toBeNull();
  });
});

describe("SLEEP_DEBT_HIGH", () => {
  it("fires above 5 hours", () => {
    const c = ctx();
    expect(sleepDebtHigh.evaluate(ctx({ sleepDebt: withDays(c.sleepDebt, [[D, { debtS: 5 * 3600 + 1, confidence: 0.7 }]]) }))?.confidence).toBe(0.7);
  });
  it("does not fire at exactly 5 hours", () => {
    const c = ctx();
    expect(sleepDebtHigh.evaluate(ctx({ sleepDebt: withDays(c.sleepDebt, [[D, { debtS: 5 * 3600, confidence: 1 }]]) }))).toBeNull();
  });
  it("does not fire without a value", () => {
    expect(sleepDebtHigh.evaluate(ctx({ sleepDebt: new Map() }))).toBeNull();
  });
});

describe("LOAD_SPIKE", () => {
  it("fires above 1.5", () => {
    const c = ctx();
    expect(loadSpike.evaluate(ctx({ acwr: withDays(c.acwr, [[D, 1.623]]) }))?.evidence[0]?.value).toBe(1.62);
  });
  it("does not fire at 1.5", () => {
    const c = ctx();
    expect(loadSpike.evaluate(ctx({ acwr: withDays(c.acwr, [[D, 1.5]]) }))).toBeNull();
  });
  it("does not fire without a ratio", () => {
    expect(loadSpike.evaluate(ctx({ acwr: new Map() }))).toBeNull();
  });
});

describe("DETRAINING", () => {
  it("fires when fitness drops over 20% in three weeks", () => {
    const c = ctx();
    expect(detraining.evaluate(ctx({ ctl: withDays(c.ctl, [[prev(21), 30], [D, 23]]) }))).not.toBeNull();
  });
  it("does not fire from a very low starting point", () => {
    const c = ctx();
    expect(detraining.evaluate(ctx({ ctl: withDays(c.ctl, [[prev(21), 5], [D, 0.1]]) }))).toBeNull();
  });
  it("does not fire without three weeks of history", () => {
    expect(detraining.evaluate(ctx({ ctl: new Map([[D, 10]]) }))).toBeNull();
  });
});

describe("MISSING_OVERNIGHT_DATA", () => {
  it("fires with no sleep and no HRV for last night", () => {
    const c = ctx();
    const sleep = new Map(c.sleep);
    sleep.delete(D);
    const hrv = new Map(c.hrvNightly);
    hrv.delete(D);
    expect(missingOvernight.evaluate(ctx({ sleep, hrvNightly: hrv }))?.severity).toBe("info");
  });
  it("does not fire when either is present", () => {
    const c = ctx();
    const sleep = new Map(c.sleep);
    sleep.delete(D);
    expect(missingOvernight.evaluate(ctx({ sleep }))).toBeNull();
  });
});

describe("RECOVERY_NORMAL", () => {
  it("fires when everything is within normal", () => {
    expect(recoveryNormal.evaluate(ctx())?.evidence.map((e) => e.id)).toEqual(["hrv_7d", "rhr_today", "sleep_last_night"]);
  });
  it("does not fire after short sleep", () => {
    const c = ctx();
    expect(recoveryNormal.evaluate(ctx({ sleep: withDays(c.sleep, [[D, NEED - 3600]]) }))).toBeNull();
  });
  it("does not fire without baselines", () => {
    expect(recoveryNormal.evaluate(ctx({ hrvBaseline: new Map() }))).toBeNull();
  });
});

describe("evaluateRules", () => {
  it("orders red flags first", () => {
    const c = ctx();
    const findings = evaluateRules(
      ctx({ rhrDaily: withDays(c.rhrDaily, [[prev(2), 61], [prev(1), 62], [D, 61]]), sleep: withDays(c.sleep, [[D, NEED - 7200]]) }),
    );
    expect(findings.map((f) => f.ruleId)).toEqual(["RHR_RED_FLAG", "RHR_ELEVATED", "SLEEP_SHORT"]);
  });
});
