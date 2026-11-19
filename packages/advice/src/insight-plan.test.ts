import type { Finding } from "@ft/metrics";
import { describe, expect, it } from "vitest";
import { morningInsight } from "./insight";
import { validateInsight } from "./validate";

describe("morning insight with PLAN_VS_READINESS", () => {
  it("words the caution from its evidence and passes the hard checks", () => {
    const finding: Finding = {
      ruleId: "PLAN_VS_READINESS",
      ruleVersion: 1,
      severity: "caution",
      confidence: 0.9,
      evidence: [
        { id: "readiness_today", metric: "readiness", label: "Readiness estimate", value: 33, unit: "score", window: "today", source: "estimate" },
        { id: "planned_duration", metric: "planned_duration", label: "Planned session", value: 4500, unit: "s", window: "today's plan", source: "estimate" },
      ],
    };
    const insight = morningInsight("2026-11-19", [finding], { sleepLastNight: true, hrvLastNight: true, restingHrToday: true });
    expect(insight.headline).toBe("A hard session is planned on a low day");
    expect(insight.body).toEqual(["Your plan has a hard, 1h 15m session today, but your readiness estimate is low, at 33."]);
    expect(validateInsight(insight).ok).toBe(true);
  });
});
