import { describe, expect, it } from "vitest";
import { DEMO_DAYS, generateDemoData } from "./demo-data";

describe("generateDemoData", () => {
  const data = generateDemoData("2026-11-16");

  it("covers every day up to today", () => {
    expect(data.days).toHaveLength(DEMO_DAYS);
    expect(data.days.at(-1)?.localDate).toBe("2026-11-16");
    expect(data.sleep).toHaveLength(DEMO_DAYS);
    expect(data.hrv).toHaveLength(DEMO_DAYS);
  });

  it("is deterministic for a seed", () => {
    expect(generateDemoData("2026-11-16")).toEqual(data);
    expect(generateDemoData("2026-11-16", 7).days[0]).not.toEqual(data.days[0]);
  });

  it("produces plausible values", () => {
    for (const d of data.days) {
      expect(d.restingHr).toBeGreaterThan(40);
      expect(d.restingHr).toBeLessThan(75);
      expect(d.steps).toBeGreaterThanOrEqual(2500);
    }
    for (const s of data.sleep) {
      expect(s.deepS + s.lightS + s.remS).toBe(s.totalSleepS);
      expect(s.endTime.getTime()).toBeGreaterThan(s.startTime.getTime());
    }
    for (const a of data.activities) {
      expect(a.hrZoneS).toHaveLength(5);
      expect(a.hrZoneS.every((z) => z >= 0)).toBe(true);
    }
  });

  it("includes runs and strength sessions with unique ids", () => {
    const sports = new Set(data.activities.map((a) => a.sport));
    expect(sports).toEqual(new Set(["running", "strength_training"]));
    expect(new Set(data.activities.map((a) => a.sourceRecordId)).size).toBe(data.activities.length);
  });

  it("has a rough week with lower HRV and higher resting HR", () => {
    const rough = data.hrv.slice(DEMO_DAYS - 35, DEMO_DAYS - 28);
    const normal = data.hrv.slice(DEMO_DAYS - 60, DEMO_DAYS - 53);
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(rough.map((h) => h.lastNightAvgMs))).toBeLessThan(avg(normal.map((h) => h.lastNightAvgMs)) - 10);
  });
});
