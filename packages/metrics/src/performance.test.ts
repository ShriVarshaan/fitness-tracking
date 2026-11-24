import { describe, expect, it } from "vitest";
import { bestAcross, bestEffortTimes, criticalFit, meanMaximal, predictRace, type BestPoint } from "./performance";

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

describe("bestEffortTimes", () => {
  it("finds the fastest stretch, interpolating between samples", () => {
    // 0–100 s at 3 m/s (300 m), then 100–200 s at 5 m/s (500 m more).
    const t = range(201);
    const d = t.map((s) => (s <= 100 ? 3 * s : 300 + 5 * (s - 100)));
    const best = bestEffortTimes(t, d, [400, 500, 800, 1000]);
    expect(best.get(400)).toBeCloseTo(80); // all in the fast part
    expect(best.get(500)).toBeCloseTo(100);
    expect(best.get(800)).toBeCloseTo(200); // the whole activity
    expect(best.has(1000)).toBe(false); // never covered
  });

  it("interpolates the end point within a sample", () => {
    // Samples every 10 s at 4 m/s: 100 m is reached at 25 s.
    expect(bestEffortTimes([0, 10, 20, 30], [0, 40, 80, 120], [100]).get(100)).toBeCloseTo(25);
  });

  it("skips missing and backwards distance values", () => {
    const best = bestEffortTimes([0, 10, 20, 30, 40], [0, null, 50, 20, 100], [100]);
    expect(best.get(100)).toBeCloseTo(40);
  });

  it("returns nothing for empty input", () => {
    expect(bestEffortTimes([], [], [100]).size).toBe(0);
  });
});

describe("meanMaximal", () => {
  it("finds the best average over each duration", () => {
    // 1 Hz: 100 W for 60 s, 300 W for 30 s, 100 W for 60 s.
    const t = range(151);
    const p = t.map((s) => (s >= 60 && s < 90 ? 300 : 100));
    const mm = meanMaximal(t, p, [30, 60, 200]);
    expect(mm.get(30)).toBeCloseTo(300);
    expect(mm.get(60)).toBeCloseTo((30 * 300 + 30 * 100) / 60); // 200
    expect(mm.has(200)).toBe(false);
  });

  it("caps gaps at 10 s so a pause does not count", () => {
    // 200 W, then a 5-minute pause, then 200 W: the pause is squeezed to 10 s.
    const t = [...range(31), ...range(31).map((s) => 330 + s)];
    const p = t.map(() => 200);
    // Clock runs 0–30, 40–70; the gap sample carries 200 W for the capped 10 s.
    expect(meanMaximal(t, p, [60]).get(60)).toBeCloseTo(200);
  });

  it("counts missing values as zero", () => {
    const t = range(11);
    const p = t.map((s) => (s < 5 ? 100 : null));
    expect(meanMaximal(t, p, [10]).get(10)).toBeCloseTo(50);
  });
});

describe("bestAcross", () => {
  it("keeps the best value per key and where it came from", () => {
    const best = bestAcross(
      [
        { id: "a", date: "2026-11-01", values: new Map([[180, 300], [300, 280]]) },
        { id: "b", date: "2026-11-05", values: new Map([[180, 320]]) },
      ],
      "max",
    );
    expect(best).toEqual([
      { key: 180, value: 320, activityId: "b", date: "2026-11-05" },
      { key: 300, value: 280, activityId: "a", date: "2026-11-01" },
    ]);
  });
});

describe("criticalFit", () => {
  it("recovers critical power and W′ from exact efforts", () => {
    // CP 250 W, W′ 20 kJ: P(t) = 250 + 20000 / t.
    const best = [180, 300, 600, 1200].map((d) => ({ durationS: d, average: 250 + 20_000 / d }));
    const fit = criticalFit(best);
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.critical).toBeCloseTo(250);
    expect(fit.reserve).toBeCloseTo(20_000);
    expect(fit.r2).toBeCloseTo(1);
    expect(fit.confidence).toBe(1);
  });

  it("recovers critical speed and D′ (3 points, lower confidence)", () => {
    // CS 4 m/s, D′ 200 m.
    const fit = criticalFit([180, 300, 600].map((d) => ({ durationS: d, average: 4 + 200 / d })));
    expect(fit.ok && fit.critical).toBeCloseTo(4);
    expect(fit.ok && fit.reserve).toBeCloseTo(200);
    expect(fit.ok && fit.confidence).toBeCloseTo(0.75);
  });

  it("refuses non-maximal efforts (no positive reserve)", () => {
    // The 20-minute average is as fast as the 3-minute one: not all-out.
    const fit = criticalFit([180, 300, 600, 1200].map((d) => ({ durationS: d, average: d === 180 ? 3 : 3.2 })));
    expect(fit.ok).toBe(false);
  });

  it("needs 3 durations", () => {
    expect(criticalFit([{ durationS: 180, average: 5 }, { durationS: 300, average: 4.5 }])).toEqual({
      ok: false,
      reason: "needs best efforts at 3 of 3, 5, 10 and 20 minutes; has 2",
    });
  });
});

describe("predictRace", () => {
  const bp = (key: number, value: number): BestPoint => ({ key, value, activityId: "x", date: "2026-11-01" });

  it("applies Riegel from the nearest best effort", () => {
    // 5 km in 20:00 → 10 km = 1200 × 2^1.06 = 2501.6 s.
    const p = predictRace(10_000, [bp(1000, 200), bp(5000, 1200)]);
    expect(p.ok && p.timeS).toBeCloseTo(1200 * 2 ** 1.06, 3);
    expect(p.ok && p.from.key).toBe(5000);
    expect(p.ok && p.confidence).toBeCloseTo(1 / (1 + Math.log(2)));
  });

  it("returns the effort itself for the same distance, at full confidence", () => {
    const p = predictRace(5000, [bp(5000, 1200), bp(10_000, 2600)]);
    expect(p.ok && p.timeS).toBeCloseTo(1200);
    expect(p.ok && p.confidence).toBe(1);
  });

  it("ignores efforts shorter than 3 km", () => {
    expect(predictRace(5000, [bp(1000, 200), bp(1609.344, 330)]).ok).toBe(false);
  });

  it("does not extrapolate more than 5 times the distance", () => {
    expect(predictRace(42_195, [bp(5000, 1200)]).ok).toBe(false);
    expect(predictRace(21_097.5, [bp(5000, 1200)]).ok).toBe(true);
  });
});
