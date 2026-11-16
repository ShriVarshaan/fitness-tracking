import { addDays } from "@ft/core";
import { weekStats, weeklyEvidence, type WeeklyInputs } from "@ft/metrics";
import { describe, expect, it } from "vitest";
import { validateInsight } from "./validate";
import { weeklyInsight } from "./weekly";

const MON = "2026-11-09";
function inputs(over: Partial<WeeklyInputs> = {}): WeeklyInputs {
  const days = Array.from({ length: 14 }, (_, i) => addDays("2026-11-02", i));
  return {
    sleepNeedS: 28_800,
    sleep: new Map(days.map((d, i) => [d, i < 7 ? 25_200 : 24_000])),
    hrv: new Map(days.map((d, i) => [d, i < 7 ? 60 : 66])),
    rhr: new Map(days.map((d) => [d, 52])),
    steps: new Map(days.map((d) => [d, 8123])),
    intensity: new Map(days.map((d) => [d, { moderate: 10, vigorous: 5 }])),
    activities: [
      { date: "2026-11-03", durationS: 1800 },
      { date: MON, durationS: 3600 },
      { date: "2026-11-11", durationS: 2700 },
    ],
    load: new Map([
      ["2026-11-03", 40],
      [MON, 80],
      ["2026-11-11", 60],
    ]),
    ...over,
  };
}

function build(i: WeeklyInputs, asOf = "2026-11-15") {
  const week = weekStats(i, MON, asOf);
  const prev = weekStats(i, "2026-11-02", asOf);
  return weeklyInsight(week.end, weeklyEvidence(week, prev, i.sleepNeedS), {
    complete: week.daysElapsed === 7,
    daysElapsed: week.daysElapsed,
    sleepNights: week.sleepNights,
  });
}

describe("weeklyInsight", () => {
  it("summarises a complete week and passes every hard check", () => {
    const insight = build(inputs());
    expect(insight.headline).toBe("Your week: 2 sessions, 6h 40m average sleep");
    expect(insight.body[0]).toBe("You trained 2 times for 1h 45m, a training load of 140 (40 the week before).");
    expect(insight.body.join(" ")).toContain("against a need of 8h 00m");
    expect(insight.body.join(" ")).toContain("the WHO guideline is 150 a week");
    expect(insight.body.join(" ")).toContain("Steps averaged 8,123 a day");
    expect(validateInsight(insight)).toMatchObject({ ok: true, ungrounded: [], uncited: [] });
  });

  it("suggests sleep and activity actions with citations", () => {
    const insight = build(inputs());
    // 6h40m average vs 8h need; 140 < 150 intensity minutes; load 140 vs 40 → big rise
    expect(insight.actions.map((a) => a.evidenceIds[0])).toEqual(["week_load", "week_sleep_avg", "week_intensity"]);
  });

  it("marks a week in progress and says so", () => {
    const insight = build(inputs(), "2026-11-11");
    expect(insight.headline).toBe("This week so far");
    expect(insight.missingData).toContain("Week in progress: 3 of 7 days so far");
    // Only the sleep nudge, worded for the rest of the week; no end-of-week judgements yet.
    expect(insight.actions.map((a) => a.text)).toEqual([
      "Earlier, more consistent bedtimes for the rest of the week would help close the gap.",
    ]);
    expect(validateInsight(insight).ok).toBe(true);
  });

  it("handles a week with no training or HRV", () => {
    const insight = build(inputs({ activities: [], load: new Map(), hrv: new Map() }));
    expect(insight.body[0]).toBe("No training was recorded this week.");
    expect(insight.missingData).toContain("HRV: no overnight readings this week");
    expect(validateInsight(insight).ok).toBe(true);
  });
});
