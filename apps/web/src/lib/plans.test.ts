import { describe, expect, it } from "vitest";
import { buildPlan, findTemplate, PLAN_TEMPLATES, sportMatches, stepsDuration, volumeFactor } from "./plans";

describe("volumeFactor", () => {
  it("adds 10% a week, eases every 4th week and the last week", () => {
    expect(volumeFactor(0, 8)).toBe(1);
    expect(volumeFactor(1, 8)).toBeCloseTo(1.1, 6);
    expect(volumeFactor(2, 8)).toBeCloseTo(1.21, 6);
    expect(volumeFactor(3, 8)).toBeCloseTo(1.331 * 0.75, 6); // easier week 4
    expect(volumeFactor(4, 8)).toBeCloseTo(1.331, 6); // the easier week doesn't count as a build week
    expect(volumeFactor(7, 8)).toBeCloseTo(1.771561 * 0.75, 4); // six build weeks before it; week 8 is a 4th week too
    expect(volumeFactor(5, 6)).toBeCloseTo(1.4641 * 0.6, 4); // last week tapers
    expect(volumeFactor(5, 6, false)).toBeCloseTo(1.4641, 4);
  });
});

describe("buildPlan", () => {
  it("lays every template out from the Monday of the start week, dropping days before the start", () => {
    for (const t of PLAN_TEMPLATES) {
      // 2026-11-16 is a Monday.
      const plan = buildPlan(t, "2026-11-16");
      expect(plan).toHaveLength(t.weeks * t.daysPerWeek);
      expect(plan[0]!.date >= "2026-11-16").toBe(true);
      for (const s of plan) {
        expect(s.targetDurationS % 60).toBe(0);
        expect(s.title.length).toBeGreaterThan(0);
        expect(s.title.length).toBeLessThanOrEqual(80);
        expect(s.steps.length).toBeLessThanOrEqual(30);
      }
    }
    // Starting on Thursday drops that week's Monday and Wednesday sessions of the 5K plan.
    const fromThu = buildPlan(findTemplate("beginner-5k")!, "2026-11-19");
    expect(fromThu[0]!.date).toBe("2026-11-21");
    expect(fromThu).toHaveLength(9 * 3 - 2);
  });

  it("builds the beginner plan to 30 minutes of running", () => {
    const plan = buildPlan(findTemplate("beginner-5k")!, "2026-11-16");
    expect(plan[0]!.title).toBe("Run 1 min, walk 1.5 min × 8");
    expect(plan.at(-1)!.title).toBe("Run 30 minutes");
    expect(plan.at(-1)!.targetDurationS).toBe(40 * 60);
  });

  it("caps the half-marathon long run at 2 hours", () => {
    const longRuns = buildPlan(findTemplate("half-marathon")!, "2026-11-16").filter((s) => s.intensity === "long");
    expect(Math.max(...longRuns.map((s) => s.targetDurationS))).toBeLessThanOrEqual(120 * 60);
    expect(longRuns[0]!.targetDurationS).toBe(60 * 60);
  });
});

describe("workout helpers", () => {
  it("adds up steps with repeats", () => {
    // 10 + 5 × 3 work + 5 × 2 recover + 10 = 45 min
    expect(
      stepsDuration([
        { kind: "warmup", durationS: 600 },
        { kind: "work", durationS: 180, repeat: 5 },
        { kind: "recover", durationS: 120 },
        { kind: "cooldown", durationS: 600 },
      ]),
    ).toBe(2700);
  });

  it("matches sport families", () => {
    expect(sportMatches("running", "trail_running")).toBe(true);
    expect(sportMatches("strength", "strength_training")).toBe(true);
    expect(sportMatches("cycling", "road_biking")).toBe(true);
    expect(sportMatches("running", "cycling")).toBe(false);
  });
});
