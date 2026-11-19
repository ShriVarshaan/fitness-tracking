import { describe, expect, it } from "vitest";
import { eveningEvidence, suggestedBedtime, type EveningInputs } from "./evening";

const base: EveningInputs = {
  date: "2026-11-19",
  steps: 8200,
  stepsGoal: 10000,
  intensityWeekSoFar: 95,
  sessionsToday: 0,
  loadToday: null,
  sleepDebtS: 1800,
  sleepNeedS: 8 * 3600,
  recentWakeMin: [420, 425, 410, 430, 415, 440, 405], // median 420 = 07:00
};

describe("suggestedBedtime", () => {
  it("is the median wake time minus sleep need", () => {
    expect(suggestedBedtime(base.recentWakeMin, 8 * 3600, 0)).toEqual({ wakeMin: 420, bedMin: 1380, earlierS: 0 }); // 23:00
  });

  it("moves earlier by half the sleep debt (to 5 min, max 30 min) once debt passes an hour", () => {
    // Debt 1 h 30 m → half is 45 min → capped at 30 min → 22:30.
    expect(suggestedBedtime(base.recentWakeMin, 8 * 3600, 5400)).toEqual({ wakeMin: 420, bedMin: 1350, earlierS: 1800 });
    // Debt 1 h 10 m → half is 35 min → 30 min cap; 1 h 2 m → 31 min → rounds to 30 min.
    expect(suggestedBedtime(base.recentWakeMin, 8 * 3600, 3720)!.earlierS).toBe(1800);
    // Exactly an hour is not "over" an hour.
    expect(suggestedBedtime(base.recentWakeMin, 8 * 3600, 3600)!.earlierS).toBe(0);
    expect(suggestedBedtime(base.recentWakeMin, 7.5 * 3600, 4200)).toEqual({ wakeMin: 420, bedMin: 1380, earlierS: 1800 });
  });

  it("wraps past midnight and needs 5 nights", () => {
    expect(suggestedBedtime([300, 300, 300, 300, 300], 8 * 3600, null)).toEqual({ wakeMin: 300, bedMin: 1260, earlierS: 0 }); // 05:00 → 21:00
    expect(suggestedBedtime([600, 600, 600, 600, 600], 9 * 3600, null)!.bedMin).toBe(60); // 10:00 → 01:00
    expect(suggestedBedtime([420, 420, 420, 420], 8 * 3600, null)).toBeNull();
  });
});

describe("eveningEvidence", () => {
  it("includes only what exists", () => {
    const ids = (i: EveningInputs) => eveningEvidence(i).map((e) => e.id);
    expect(ids(base)).toEqual(["evening_steps", "evening_week_intensity", "evening_sleep_debt", "evening_sleep_need", "evening_usual_wake", "evening_bedtime"]);
    expect(ids({ ...base, steps: null, intensityWeekSoFar: null, sleepDebtS: null, recentWakeMin: [] })).toEqual([]);
    expect(ids({ ...base, sessionsToday: 1, loadToday: 64.6, sleepDebtS: 5400 })).toContain("evening_earlier");
    const load = eveningEvidence({ ...base, sessionsToday: 2, loadToday: 64.6 }).find((e) => e.id === "evening_load");
    expect(load).toMatchObject({ value: 65, source: "estimate" });
  });
});
