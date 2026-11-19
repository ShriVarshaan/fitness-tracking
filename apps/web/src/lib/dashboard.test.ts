import { describe, expect, it } from "vitest";
import { DASHBOARD_TEMPLATES, panelsSchema, panelSchema, periodRange, rollWeekly, shiftDates } from "./dashboard";

const panel = { id: "a1", metrics: ["steps"], periodDays: 90, granularity: "week", chart: "bar", compare: false };

describe("panel validation", () => {
  it("accepts every template", () => {
    for (const t of DASHBOARD_TEMPLATES) expect(panelsSchema.safeParse(t.panels).success).toBe(true);
  });

  it("keeps one y-axis per panel and limits comparisons to one metric", () => {
    expect(panelSchema.safeParse(panel).success).toBe(true);
    expect(panelSchema.safeParse({ ...panel, metrics: ["steps", "resting_hr"] }).success).toBe(false); // steps and bpm
    expect(panelSchema.safeParse({ ...panel, metrics: ["ctl", "atl"] }).success).toBe(true); // both load
    expect(panelSchema.safeParse({ ...panel, metrics: ["ctl", "atl"], compare: true }).success).toBe(false);
    expect(panelSchema.safeParse({ ...panel, metrics: ["nope"] }).success).toBe(false);
    expect(panelSchema.safeParse({ ...panel, periodDays: 45 }).success).toBe(false);
    expect(panelSchema.safeParse({ ...panel, id: "<script>" }).success).toBe(false);
  });
});

describe("rollWeekly", () => {
  // 2026-11-02 and 2026-11-09 are Mondays.
  const values = new Map([
    ["2026-11-04", 10],
    ["2026-11-05", 20],
    ["2026-11-10", 40],
  ]);
  it("sums, averages or takes the last value per Monday week, clipped to the range", () => {
    expect(rollWeekly(values, "2026-11-05", "2026-11-17", "sum")).toEqual({ weeks: ["2026-11-02", "2026-11-09", "2026-11-16"], values: [20, 40, null] });
    expect(rollWeekly(values, "2026-11-02", "2026-11-15", "avg").values).toEqual([15, 40]);
    expect(rollWeekly(values, "2026-11-02", "2026-11-15", "last").values).toEqual([20, 40]);
  });
});

describe("period helpers", () => {
  it("finds the previous period and shifts it onto the current dates", () => {
    expect(periodRange("2026-11-30", 30)).toEqual({ from: "2026-11-01", prevFrom: "2026-10-02", prevTo: "2026-10-31" });
    expect([...shiftDates(new Map([["2026-10-02", 5]]), 30)]).toEqual([["2026-11-01", 5]]);
  });
});
