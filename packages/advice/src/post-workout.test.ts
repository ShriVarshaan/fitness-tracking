import type { Evidence, Finding } from "@ft/metrics";
import { describe, expect, it } from "vitest";
import { postWorkoutInsight } from "./post-workout";
import { buildRewordRequest } from "./reword";
import { validateInsight } from "./validate";

const ev = (id: string, value: number, unit: string, baseline?: number): Evidence => ({
  id,
  metric: id,
  label: id,
  value,
  unit,
  ...(baseline !== undefined ? { baseline } : {}),
  window: "this session",
  source: id === "session_load" ? "estimate" : "garmin",
});

const run = (load: Evidence | null, extra: Evidence[] = []) => [
  ev("session_duration", 3000, "s"),
  ev("session_distance", 10.1, "km"),
  ev("session_avg_hr", 151, "bpm"),
  ...(load ? [load] : []),
  ...extra,
];

const ctx = (dayFindings: Finding[] = []) => ({ activityId: "123", sport: "Running", dayFindings });

const hrvLow: Finding = {
  ruleId: "HRV_BELOW_NORMAL",
  ruleVersion: 1,
  severity: "caution",
  confidence: 0.8,
  evidence: [ev("hrv_7d", 48, "ms", 60), ev("hrv_band_low", 52, "ms")],
};

describe("postWorkoutInsight", () => {
  it("describes a typical session and passes every hard check", () => {
    const insight = postWorkoutInsight("2026-11-16", run(ev("session_load", 95, "load", 90)), ctx());
    expect(insight.headline).toBe("A typical running session");
    expect(insight.body).toEqual([
      "You did 50m of running, covering 10.1 km, at an average heart rate of 151 bpm.",
      "Its training load was 95, close to your typical session (90).",
    ]);
    expect(insight.actions).toEqual([]);
    expect(insight.confidence).toBe("high");
    expect(insight.activityId).toBe("123");
    expect(validateInsight(insight)).toMatchObject({ ok: true, ungrounded: [], uncited: [] });
  });

  it("flags a big session with a cited recovery action", () => {
    const insight = postWorkoutInsight("2026-11-16", run(ev("session_load", 180, "load", 90), [ev("session_rpe", 8, "/10")]), ctx());
    expect(insight.headline).toBe("A big running session");
    expect(insight.body).toContain("Its training load was 180, well above your typical session (90).");
    expect(insight.body).toContain("You rated the effort 8/10.");
    expect(insight.actions.map((a) => a.evidenceIds)).toEqual([["session_load"]]);
    expect(validateInsight(insight).ok).toBe(true);
  });

  it("links a hard session to low morning markers", () => {
    const insight = postWorkoutInsight("2026-11-16", run(ev("session_load", 120, "load", 90)), ctx([hrvLow]));
    expect(insight.body).toContain("This came on a day when your 7-night HRV average was 48 ms, below its usual range.");
    expect(insight.actions).toEqual([
      { text: "Keep the next day or two light and see how your morning numbers respond.", evidenceIds: ["session_load", "hrv_7d"] },
    ]);
    expect(insight.ruleIds).toEqual(["POST_WORKOUT", "HRV_BELOW_NORMAL"]);
    expect(validateInsight(insight).ok).toBe(true);
  });

  it("says nothing about markers after an easy session", () => {
    const insight = postWorkoutInsight("2026-11-16", run(ev("session_load", 40, "load", 90)), ctx([hrvLow]));
    expect(insight.headline).toBe("An easy running session");
    expect(insight.actions).toEqual([]);
  });

  it("admits a missing comparison or missing heart rate", () => {
    const noBaseline = postWorkoutInsight("2026-11-16", run(ev("session_load", 95, "load")), ctx());
    expect(noBaseline.headline).toBe("Running: 50m");
    expect(noBaseline.confidence).toBe("medium");
    expect(noBaseline.missingData).toEqual(["Comparison: fewer than 3 earlier sessions with heart rate in the last 4 weeks"]);

    const noHr = postWorkoutInsight("2026-11-16", [ev("session_duration", 2700, "s")], { ...ctx(), sport: "Strength training" });
    expect(noHr.body).toEqual(["You did 45m of strength training."]);
    expect(noHr.confidence).toBe("low");
    expect(noHr.missingData).toEqual(["Training load: no heart-rate data for this session"]);
    expect(validateInsight(noHr).ok).toBe(true);
  });

  it("carries the day's red flags with fixed wording", () => {
    const red: Finding = { ruleId: "RHR_RED_FLAG", ruleVersion: 1, severity: "red_flag", confidence: 0.9, evidence: [] };
    const insight = postWorkoutInsight("2026-11-16", run(ev("session_load", 95, "load", 90)), ctx([red]));
    expect(insight.headline).toBe("Something to check");
    expect(insight.redFlags[0]!.text).toContain("NHS 111");
  });

  it("tells the model what kind of summary it is rewording", () => {
    const insight = postWorkoutInsight("2026-11-16", run(ev("session_load", 95, "load", 90)), ctx());
    expect(buildRewordRequest(insight).system).toContain("a workout someone just did");
  });
});
