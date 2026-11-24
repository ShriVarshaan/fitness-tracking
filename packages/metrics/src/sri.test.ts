import { addDays } from "@ft/core";
import { describe, expect, it } from "vitest";
import { sleepRegularityIndex, sleepWakeMinutes, type SleepNightIntervals } from "./sleep";

/** A night dated `date`, asleep from `bed` (HH:MM, the evening before or, if `sameDay`, on the date) to `wake` (HH:MM on the date). */
const night = (date: string, bed: string, wake: string, opts: { fromStages?: boolean; tz?: number; sameDay?: boolean } = {}): SleepNightIntervals => {
  const tz = opts.tz ?? 0;
  const start = Date.parse(`${opts.sameDay ? date : addDays(date, -1)}T${bed}:00Z`) - tz * 60_000;
  const end = Date.parse(`${date}T${wake}:00Z`) - tz * 60_000;
  return { date, tzOffsetMin: tz, asleep: [[start, end]], fromStages: opts.fromStages ?? true };
};
const dates = (n: number, end = "2026-11-20") => Array.from({ length: n }, (_, i) => addDays(end, i - n + 1));

describe("sleepWakeMinutes", () => {
  it("marks the night's minutes from noon to noon", () => {
    const m = sleepWakeMinutes(night("2026-11-20", "23:00", "07:00"));
    // Noon to 23:00 is 660 minutes awake, then 480 asleep.
    expect(m.indexOf(true)).toBe(660);
    expect(m.filter(Boolean)).toHaveLength(480);
  });

  it("uses the night's own time zone", () => {
    expect(sleepWakeMinutes(night("2026-11-20", "23:00", "07:00", { tz: 120 }))).toEqual(sleepWakeMinutes(night("2026-11-20", "23:00", "07:00")));
  });
});

describe("sleepRegularityIndex", () => {
  it("is 100 for identical timing every day", () => {
    const r = sleepRegularityIndex(dates(14).map((d) => night(d, "23:00", "07:00")), "2026-11-20");
    expect(r.ok && r.sri).toBe(100);
    expect(r.ok && r.pairs).toBe(13);
    expect(r.ok && r.confidence).toBe(1);
  });

  it("matches a hand calculation for alternating schedules", () => {
    // 23:00–07:00 and 01:00–09:00 alternate: 360 min overlap, 240 min disagree per pair.
    // SRI = −100 + 200 × 1200 / 1440 = 66.67.
    const r = sleepRegularityIndex(
      dates(8).map((d, i) => (i % 2 ? night(d, "23:00", "07:00") : night(d, "01:00", "09:00", { sameDay: true }))),
      "2026-11-20",
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sri).toBeCloseTo(-100 + (200 * 1200) / 1440, 6);
      expect(r.pairs).toBe(7);
    }
  });

  it("counts wake-ups inside the night when stages are known", () => {
    const ds = dates(6);
    const nights = ds.map((d, i) => {
      const n = night(d, "23:00", "07:00");
      if (i % 2 === 0) return n;
      const [a, b] = n.asleep[0]!;
      // Awake from 02:00 to 03:00.
      return { ...n, asleep: [[a, a + 3 * 3600_000], [a + 4 * 3600_000, b]] as Array<[number, number]> };
    });
    const r = sleepRegularityIndex(nights, "2026-11-20");
    // 60 of 1440 minutes disagree in every pair.
    expect(r.ok && r.sri).toBeCloseTo(-100 + (200 * 1380) / 1440, 6);
  });

  it("skips days without a night instead of counting them awake, and lowers confidence for start/end-only nights", () => {
    const ds = dates(14).filter((_, i) => i !== 6);
    const r = sleepRegularityIndex(ds.map((d) => night(d, "23:00", "07:00", { fromStages: false })), "2026-11-20");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.pairs).toBe(11);
      expect(r.sri).toBe(100);
      expect(r.approximate).toBe(true);
      // sufficiency(11, 5, 13) = 0.5 + 0.5 × 6/8 = 0.875, × 0.6
      expect(r.confidence).toBeCloseTo(0.875 * 0.6);
    }
  });

  it("ignores nights outside the 14-day window", () => {
    const r = sleepRegularityIndex(dates(20).map((d) => night(d, "23:00", "07:00")), "2026-11-20");
    expect(r.ok && r.pairs).toBe(13);
  });

  it("needs 5 pairs", () => {
    const r = sleepRegularityIndex(dates(5).map((d) => night(d, "23:00", "07:00")), "2026-11-20");
    expect(r).toEqual({ ok: false, reason: "needs 5 pairs of consecutive recorded nights in the last 14 days; has 4" });
  });
});
