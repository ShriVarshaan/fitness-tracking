import { describe, expect, it } from "vitest";
import { daysCovered, lastOfYear, monthStarts, recap, type RecapInputs } from "./recap";

const act = (id: string, date: string, sport: string, min: number, km = 0, ascent = 0) => ({
  id,
  date,
  sport,
  durationS: min * 60,
  distanceM: km * 1000,
  ascentM: ascent,
  name: null,
});

const base: RecapInputs = {
  year: 2026,
  activities: [
    act("a", "2026-01-05", "running", 30, 5, 40),
    act("b", "2026-01-06", "running", 60, 10, 120),
    act("c", "2026-01-07", "strength_training", 45),
    act("d", "2026-03-10", "cycling", 120, 40, 300),
    act("old", "2025-12-31", "running", 600, 100), // other year: ignored
  ],
  days: [
    { date: "2026-01-05", steps: 12000, moderate: 100, vigorous: 30 }, // week of 5 Jan: 160 → met
    { date: "2026-01-12", steps: 8000, moderate: 20, vigorous: 0 }, // week of 12 Jan: 20
    { date: "2026-01-13", steps: null, moderate: null, vigorous: null },
  ],
  sleep: [
    { date: "2026-01-05", totalS: 7 * 3600 },
    { date: "2026-01-06", totalS: 8 * 3600 },
  ],
  hrv: Array.from({ length: 40 }, (_, k) => ({ date: `2026-02-${String((k % 28) + 1).padStart(2, "0")}`, ms: k < 20 ? 50 : 60 })),
  rhr: [],
};

describe("recap", () => {
  const r = recap(base);

  it("totals the year's sessions only", () => {
    expect([r.sessions, r.hours, r.km, r.ascentM, r.activeDays]).toEqual([4, 4.25, 55, 460, 4]);
    expect(r.bySport.map((s) => [s.sport, s.sessions, s.hours])).toEqual([
      ["cycling", 1, 2],
      ["running", 2, 1.5],
      ["strength_training", 1, 0.75],
    ]);
    expect(r.monthlyHours.slice(0, 3)).toEqual([2.25, 0, 2]);
  });

  it("finds highlights", () => {
    expect(r.longestSession?.id).toBe("d");
    expect(r.furthestSession?.id).toBe("d");
    expect(r.biggestWeek).toEqual({ monday: "2026-01-05", hours: 2.25 });
    expect(r.longestStreak).toEqual({ days: 3, from: "2026-01-05", to: "2026-01-07" });
    expect(r.steps).toEqual({ total: 20000, bestDay: { date: "2026-01-05", steps: 12000 }, daysRecorded: 2 });
    expect(r.whoWeeks).toEqual({ met: 1, of: 2 });
    expect(r.sleep).toEqual({ avgS: 7.5 * 3600, nights: 2 });
  });

  it("compares first and last quarters only with enough readings", () => {
    // 40 readings sorted by date; quarters of 10.
    expect(r.hrvChange).not.toBeNull();
    expect(r.rhrChange).toBeNull();
  });

  it("is empty-safe", () => {
    const e = recap({ year: 2026, activities: [], days: [], sleep: [], hrv: [], rhr: [] });
    expect([e.sessions, e.longestSession, e.biggestWeek, e.longestStreak, e.sleep]).toEqual([0, null, null, null, null]);
  });
});

describe("recap dates", () => {
  it("lists month starts and counts days so far", () => {
    expect(monthStarts(2026)[11]).toBe("2026-12-01");
    expect(daysCovered(2026, "2026-01-10")).toBe(10);
    expect(daysCovered(2025, "2026-01-10")).toBe(365);
    expect(lastOfYear(2024)).toBe("2024-12-31");
  });
});
