import { addDays } from "@ft/core";
import { describe, expect, it } from "vitest";
import { weekStart, weekStats, weeklyEvidence, type WeeklyInputs } from "./weekly";

const MON = "2026-11-09"; // a Monday

function inputs(): WeeklyInputs {
  const days = Array.from({ length: 14 }, (_, i) => addDays("2026-11-02", i));
  return {
    sleepNeedS: 28_800,
    sleep: new Map(days.map((d, i) => [d, i < 7 ? 25_200 : 27_000])), // 7h previous week, 7h30 this week
    hrv: new Map(days.map((d, i) => [d, i < 7 ? 60 : 66])),
    rhr: new Map(days.map((d) => [d, 52])),
    steps: new Map(days.map((d) => [d, 8000])),
    intensity: new Map(days.map((d) => [d, { moderate: 10, vigorous: 5 }])), // 20 WHO-weighted min a day
    activities: [
      { date: "2026-11-03", durationS: 1800 },
      { date: MON, durationS: 3600 },
      { date: "2026-11-11", durationS: 2700 },
      { date: "2026-11-15", durationS: 5400 },
    ],
    load: new Map([
      ["2026-11-03", 40],
      [MON, 80],
      ["2026-11-11", 60],
      ["2026-11-15", 120],
    ]),
  };
}

describe("weekStart", () => {
  it("finds the Monday of the week", () => {
    expect(weekStart("2026-11-09")).toBe(MON);
    expect(weekStart("2026-11-15")).toBe(MON); // Sunday
    expect(weekStart("2026-11-16")).toBe("2026-11-16");
  });
});

describe("weekStats", () => {
  it("totals a complete week", () => {
    const w = weekStats(inputs(), MON, "2026-11-20");
    expect(w).toMatchObject({
      end: "2026-11-15",
      daysElapsed: 7,
      sessions: 3,
      trainingS: 11_700,
      load: 260,
      sleepAvgS: 27_000,
      sleepNights: 7,
      hrvAvgMs: 66,
      stepsAvg: 8000,
      intensityMin: 140,
    });
  });

  it("covers only the days so far in the current week", () => {
    const w = weekStats(inputs(), MON, "2026-11-11");
    expect(w).toMatchObject({ daysElapsed: 3, sessions: 2, load: 140, intensityMin: 60 });
  });
});

describe("weeklyEvidence", () => {
  it("compares with the previous week and the WHO target", () => {
    const i = inputs();
    const ev = weeklyEvidence(weekStats(i, MON, "2026-11-15"), weekStats(i, "2026-11-02", "2026-11-15"), i.sleepNeedS);
    const by = Object.fromEntries(ev.map((e) => [e.id, e]));
    expect(by.week_sessions).toMatchObject({ value: 3, baseline: 1 });
    expect(by.week_load).toMatchObject({ value: 260, baseline: 40 });
    expect(by.week_sleep_avg).toMatchObject({ value: 27_000, baseline: 28_800 });
    expect(by.week_hrv_avg).toMatchObject({ value: 66, baseline: 60 });
    expect(by.week_intensity).toMatchObject({ value: 140, baseline: 150 });
  });

  it("leaves out what wasn't recorded", () => {
    const i = { ...inputs(), hrv: new Map(), sleep: new Map() };
    const ids = weeklyEvidence(weekStats(i, MON, "2026-11-15"), null, 28_800).map((e) => e.id);
    expect(ids).not.toContain("week_hrv_avg");
    expect(ids).not.toContain("week_sleep_avg");
  });
});
