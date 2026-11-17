import { evaluateRules } from "@ft/metrics";
import { describe, expect, it } from "vitest";
import { D, full, healthy, SCENARIOS } from "./eval-scenarios";
import { morningInsight, RED_FLAG_TEXT } from "./insight";
import { safetyViolations, ungroundedNumbers, validateInsight } from "./validate";

/** Template insights for every scenario must pass the hard checks (docs/PLAN.md §10). */
describe("advice evaluation scenarios", () => {
  for (const s of SCENARIOS) {
    describe(s.name, () => {
      const findings = evaluateRules(s.ctx());
      const insight = morningInsight(D, findings, s.availability ?? full);

      it("fires the expected rules", () => {
        expect(findings.map((f) => f.ruleId).sort()).toEqual([...s.expectRules].sort());
      });

      it("passes every hard check (grounding, citations, safety, missing data)", () => {
        expect(validateInsight(insight)).toMatchObject({ ok: true, ungrounded: [], uncited: [], unsafe: [] });
      });

      it("uses the fixed red-flag wording, and only for red flags", () => {
        if (s.expectRedFlag) {
          expect(insight.headline).toBe("Something to check");
          for (const rf of insight.redFlags) expect(rf.text).toBe(RED_FLAG_TEXT[rf.ruleId]);
          expect(insight.redFlags.map((r) => r.text).join(" ")).toMatch(/NHS 111/);
        } else {
          expect(insight.redFlags).toEqual([]);
        }
      });
    });
  }

  it("acknowledges missing data when confidence is low", () => {
    const s = SCENARIOS.find((x) => x.name.startsWith("new user"))!;
    const insight = morningInsight(D, evaluateRules(s.ctx()), s.availability!);
    expect(insight.confidence).toBe("low");
    expect(insight.missingData.length).toBeGreaterThan(0);
  });
});

describe("validators", () => {
  const insight = morningInsight(D, evaluateRules(healthy()), full);

  it("flags a number that isn't in the evidence", () => {
    expect(ungroundedNumbers("Your HRV is 91 ms today.", insight)).toEqual(["91"]);
    expect(ungroundedNumbers("Your HRV is 70 ms today.", insight)).toEqual([]);
  });

  it("blocks diagnosis and dosing language", () => {
    expect(safetyViolations("You may have an infection.")).not.toEqual([]);
    expect(safetyViolations("Take 400 mg of ibuprofen.")).not.toEqual([]);
    expect(safetyViolations("Consider an easier day.")).toEqual([]);
  });

  it("rejects an action with no evidence", () => {
    const bad = { ...insight, actions: [{ text: "Do something", evidenceIds: [] }] };
    expect(validateInsight(bad).uncited).toEqual(["Do something"]);
  });
});
