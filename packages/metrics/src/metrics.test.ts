import { addDays } from "@ft/core";
import { describe, expect, it } from "vitest";
import { hrvBaseline, rhrBaseline } from "./baselines";
import { sampleSd, sufficiency, type DatedValue } from "./common";
import { acwr, edwardsTrimp, pmc } from "./load";
import { logistic, readiness } from "./readiness";
import { sleepDebt } from "./sleep";

// Expected values below were computed by hand from the formulas in docs/PLAN.md §6
// (plain arithmetic, independent of this package).

const series = (start: string, values: Array<number | null>): DatedValue[] =>
  values.flatMap((v, i) => (v === null ? [] : [{ date: addDays(start, i), value: v }]));

describe("common", () => {
  it("uses the sample (n − 1) standard deviation", () => {
    expect(sampleSd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.13809, 5);
    expect(sampleSd([5])).toBe(0);
  });

  it("scales confidence from 0.5 at the minimum to 1 at full", () => {
    expect(sufficiency(13, 14, 30)).toBe(0);
    expect(sufficiency(14, 14, 30)).toBe(0.5);
    expect(sufficiency(22, 14, 30)).toBe(0.75);
    expect(sufficiency(40, 14, 30)).toBe(1);
  });
});

describe("hrvBaseline (Plews ln-RMSSD)", () => {
  // 20 nights alternating ln 4.0 / ln 4.2, ending on a 4.2 night.
  const nights = series(
    "2026-01-01",
    Array.from({ length: 20 }, (_, i) => Math.exp(i % 2 === 0 ? 4 : 4.2)),
  );

  it("matches hand-computed baseline, band and z", () => {
    const r = hrvBaseline(nights, "2026-01-20");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.baselineMs).toBeCloseTo(60.34029, 4);
    expect(r.bandLowMs).toBeCloseTo(57.32295, 4);
    expect(r.bandHighMs).toBeCloseTo(63.51645, 4);
    expect(r.rollingMs).toBeCloseTo(61.20848, 4);
    expect(r.z).toBeCloseTo(0.13924, 4);
    expect(r.nights).toBe(20);
    expect(r.confidence).toBe(0.6875);
  });

  it("returns no value with fewer than 14 nights", () => {
    const r = hrvBaseline(nights.slice(0, 13), "2026-01-13");
    expect(r).toEqual({ ok: false, reason: "needs 14 nights of HRV in the last 60 days; has 13" });
  });

  it("needs 3 recent nights for the rolling mean", () => {
    const gappy = [...nights.slice(0, 18)]; // last night is 18 Jan
    const r = hrvBaseline(gappy, "2026-01-24"); // 7-day window 18–24 Jan holds one night
    expect(r.ok).toBe(false);
  });

  it("ignores zero or negative readings", () => {
    const r = hrvBaseline([...nights, { date: "2026-01-21", value: 0 }], "2026-01-21");
    expect(r.ok && r.nights).toBe(20);
  });

  it("gives z = 0 when every night is identical", () => {
    const flat = series("2026-01-01", Array(20).fill(55));
    const r = hrvBaseline(flat, "2026-01-20");
    expect(r.ok && r.z).toBe(0);
  });
});

describe("rhrBaseline", () => {
  const days = series("2026-02-01", [...Array(7).fill(50), ...Array(7).fill(60)]);

  it("matches hand-computed baseline and elevated threshold", () => {
    const r = rhrBaseline(days, "2026-02-14");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.baselineBpm).toBe(55);
    expect(r.sdBpm).toBeCloseTo(5.18875, 4);
    expect(r.rollingBpm).toBe(60);
    expect(r.elevatedAboveBpm).toBeCloseTo(65.37749, 4);
    expect(r.confidence).toBe(0.5);
  });

  it("uses at least 5 bpm above baseline when variation is small", () => {
    const steady = series("2026-02-01", Array(20).fill(52));
    const r = rhrBaseline(steady, "2026-02-20");
    expect(r.ok && r.elevatedAboveBpm).toBe(57);
  });

  it("returns no value with fewer than 14 days", () => {
    expect(rhrBaseline(days.slice(0, 10), "2026-02-10").ok).toBe(false);
  });
});

describe("sleepDebt", () => {
  const need = 8 * 3600;
  // 7 nights ending 7 Mar: 7h, 8h, 8h20, missing, 7h30, missing, 6h
  const nights = series("2026-03-01", [25_200, 28_800, 30_000, null, 27_000, null, 21_600]);

  it("sums the shortfall over recorded nights only", () => {
    const r = sleepDebt(nights, "2026-03-07", need);
    expect(r).toEqual({ ok: true, confidence: 5 / 7, debtS: 12_600, nights: 5 });
  });

  it("needs at least 3 recorded nights", () => {
    expect(sleepDebt(nights.slice(0, 2), "2026-03-07", need).ok).toBe(false);
  });

  it("refuses a missing sleep need", () => {
    expect(sleepDebt(nights, "2026-03-07", 0).ok).toBe(false);
  });
});

describe("edwardsTrimp", () => {
  it("weights minutes by zone number", () => {
    expect(edwardsTrimp([600, 600, 600, 600, 600])).toBe(150);
    expect(edwardsTrimp([60, 120, 0, 0, 0])).toBe(5);
  });

  it("returns null without zone data", () => {
    expect(edwardsTrimp(null)).toBeNull();
    expect(edwardsTrimp([0, 0, 0, 0, 0])).toBeNull();
    expect(edwardsTrimp([600, 600])).toBeNull();
  });
});

describe("pmc (fitness / fatigue / form)", () => {
  it("matches the hand-computed EWMA after one session", () => {
    const days = pmc(new Map([["2026-04-01", 100]]), "2026-04-01", "2026-04-02");
    expect(days[0]).toMatchObject({ load: 100, tsb: 0 });
    expect(days[0]!.ctl).toBeCloseTo(2.35283, 4);
    expect(days[0]!.atl).toBeCloseTo(13.31221, 4);
    // Form uses yesterday's values.
    expect(days[1]!.tsb).toBeCloseTo(-10.95938, 4);
    expect(days[1]!.load).toBe(0);
  });

  it("reaches full confidence after 42 days of history", () => {
    const days = pmc(new Map(), "2026-01-01", "2026-03-01");
    expect(days[20]!.confidence).toBeCloseTo(21 / 42, 6);
    expect(days[41]!.confidence).toBe(1);
  });
});

describe("acwr (descriptive load-spike ratio)", () => {
  it("matches the hand-computed EWMA ratio after 28 days of steady load", () => {
    const loads = new Map(Array.from({ length: 28 }, (_, i) => [addDays("2026-05-01", i), 100] as const));
    const days = acwr(loads, "2026-05-01", "2026-05-28");
    expect(days[26]!.ratio).toBeNull();
    expect(days[27]!.acute).toBeCloseTo(99.96825, 4);
    expect(days[27]!.chronic).toBeCloseTo(86.47798, 4);
    expect(days[27]!.ratio).toBeCloseTo(1.15600, 4);
  });

  it("gives no ratio while chronic load is near zero", () => {
    const days = acwr(new Map(), "2026-05-01", "2026-06-15");
    expect(days.at(-1)!.ratio).toBeNull();
  });
});

describe("readiness (heuristic estimate)", () => {
  it("is 50 per component at baseline and renormalises over missing parts", () => {
    const r = readiness({
      hrv: { z: 0, confidence: 1 },
      rhr: { todayBpm: 55, baselineBpm: 55, sdBpm: 3, confidence: 1 },
      sleep: { actualS: 28_800, needS: 28_800 },
      load: { tsb: 0, confidence: 1 },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.score).toBeCloseTo(61.1111, 3);
    expect(r.confidence).toBeCloseTo(0.9, 6);
    expect(r.missing).toEqual(["regularity"]);
    expect(r.components).toEqual({ hrv: 50, rhr: 50, sleep: 100, load: 50 });
  });

  it("maps sleep from 50% of need (0) to 100% of need (100)", () => {
    const half = readiness({ hrv: { z: 0, confidence: 1 }, rhr: null, sleep: { actualS: 14_400, needS: 28_800 } });
    expect(half.ok && half.components.sleep).toBe(0);
  });

  it("drops the load part when the load model is too new", () => {
    const r = readiness({
      hrv: { z: 0, confidence: 1 },
      rhr: { todayBpm: 55, baselineBpm: 55, sdBpm: 3, confidence: 1 },
      load: { tsb: 5, confidence: 0.4 },
    });
    expect(r.ok && r.missing).toContain("load");
  });

  it("gives no score with under half the inputs", () => {
    const r = readiness({ sleep: { actualS: 28_800, needS: 28_800 } });
    expect(r).toMatchObject({ ok: false, missing: ["hrv", "rhr", "regularity", "load"] });
  });

  it("uses a logistic centred on 50", () => {
    expect(logistic(0)).toBe(50);
    expect(logistic(2)).toBeGreaterThan(90);
    expect(logistic(-2)).toBeLessThan(10);
  });
});
