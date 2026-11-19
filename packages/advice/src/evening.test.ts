import { eveningEvidence, type EveningInputs } from "@ft/metrics";
import { describe, expect, it } from "vitest";
import { eveningInsight } from "./evening";
import { validateInsight } from "./validate";

const inputs: EveningInputs = {
  date: "2026-11-19",
  steps: 8200,
  stepsGoal: 10000,
  intensityWeekSoFar: 95,
  sessionsToday: 1,
  loadToday: 64.6,
  sleepDebtS: 5400,
  sleepNeedS: 8 * 3600,
  recentWakeMin: [420, 425, 410, 430, 415, 440, 405],
};

describe("eveningInsight", () => {
  it("covers the day and tonight's sleep, and passes every hard check", () => {
    const insight = eveningInsight("2026-11-19", eveningEvidence(inputs));
    expect(insight.headline).toBe("Aim to be asleep by 22:30");
    expect(insight.body).toEqual([
      "You've taken 8,200 steps today, against a goal of 10,000 steps.",
      "You trained today, with a training load of 65.",
      "This week you have 95 min of activity so far, towards the WHO's 150 min a week.",
      "Your sleep debt over the last 7 nights is 1h 30m.",
      "You usually wake around 07:00, so being asleep by 22:30 gives you your 8h 00m of sleep, plus 30m towards your sleep debt.",
    ]);
    expect(insight.actions.map((a) => a.text)).toEqual([
      "A short walk this evening would close the gap on your step goal.",
      "Start winding down before 22:30: dim the lights and put screens away.",
    ]);
    expect(insight.confidence).toBe("high");
    expect(validateInsight(insight).ok).toBe(true);
  });

  it("says what is missing without enough nights or a daily summary", () => {
    const insight = eveningInsight("2026-11-19", eveningEvidence({ ...inputs, steps: null, recentWakeMin: [420], sessionsToday: 0, sleepDebtS: 0 }));
    expect(insight.headline).toBe("Your evening check-in");
    expect(insight.body).toContain("You have no sleep debt over the last 7 nights.");
    expect(insight.missingData).toEqual(["Steps: no daily summary for today yet", "Bedtime suggestion: needs wake times from at least 5 recent nights"]);
    expect(insight.confidence).toBe("low");
    expect(validateInsight(insight).ok).toBe(true);
  });

  it("celebrates a reached step goal when there is no bedtime", () => {
    const insight = eveningInsight("2026-11-19", eveningEvidence({ ...inputs, steps: 12000, recentWakeMin: [] }));
    expect(insight.headline).toBe("Step goal reached today");
    expect(insight.body[0]).toBe("You've taken 12,000 steps today, past your goal of 10,000 steps.");
  });
});
