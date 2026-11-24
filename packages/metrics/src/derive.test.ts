import { addDays } from "@ft/core";
import { describe, expect, it } from "vitest";
import { deriveAll, type DeriveInputs } from "./derive";

const days = (n: number, start = "2026-01-01") => Array.from({ length: n }, (_, i) => addDays(start, i));

function inputs(n: number): DeriveInputs {
  const dates = days(n);
  return {
    hrv: dates.map((date) => ({ date, value: 60 })),
    rhr: dates.map((date) => ({ date, value: 52 })),
    sleep: dates.map((date) => ({ date, value: 8 * 3600 })),
    activities: [{ date: dates[0]!, zoneSeconds: [600, 600, 600, 600, 600] }, { date: dates[1]!, zoneSeconds: null }],
    sleepNeedS: 8 * 3600,
  };
}

const pick = (rows: ReturnType<typeof deriveAll>, date: string, code: string) =>
  rows.find((r) => r.localDate === date && r.metricCode === code);

describe("deriveAll", () => {
  it("returns nothing without inputs", () => {
    expect(deriveAll({ hrv: [], rhr: [], sleep: [], activities: [], sleepNeedS: 28_800 })).toEqual([]);
  });

  it("produces one row per metric per day", () => {
    const rows = deriveAll(inputs(20));
    const codes = new Set(rows.map((r) => r.metricCode));
    expect([...codes].sort()).toEqual(
      ["acwr", "atl", "ctl", "hrv_baseline", "readiness", "rhr_baseline", "sleep_debt", "sri", "trimp_daily", "tsb"].sort(),
    );
    expect(rows).toHaveLength(20 * codes.size);
  });

  it("feeds the Sleep Regularity Index into readiness", () => {
    const base = inputs(20);
    const nights = days(20).map((date) => {
      const end = Date.parse(`${date}T07:00:00Z`);
      return { date, tzOffsetMin: 0, asleep: [[end - 8 * 3600_000, end]] as Array<[number, number]>, fromStages: false };
    });
    const rows = deriveAll({ ...base, sleepNights: nights });
    const sri = pick(rows, "2026-01-20", "sri");
    expect(sri?.value).toBe(100);
    expect(sri?.components).toEqual({ pairs: 13, approximate: true });
    const ready = pick(rows, "2026-01-20", "readiness");
    expect(ready?.components.missing).not.toContain("regularity");
    expect((ready?.components.components as Record<string, number>).regularity).toBe(100);
    // Without nights, regularity is listed as missing.
    expect(pick(deriveAll(base), "2026-01-20", "readiness")?.components.missing).toContain("regularity");
  });

  it("stores a reason, not a guess, before there is enough history", () => {
    const rows = deriveAll(inputs(20));
    const early = pick(rows, "2026-01-05", "hrv_baseline");
    expect(early?.value).toBeNull();
    expect(early?.components.reason).toMatch(/needs 14 nights/);
    expect(pick(rows, "2026-01-14", "hrv_baseline")?.value).toBeCloseTo(60, 6);
  });

  it("totals Edwards TRIMP per day and counts activities without HR zones", () => {
    const rows = deriveAll(inputs(5));
    expect(pick(rows, "2026-01-01", "trimp_daily")?.value).toBe(150);
    expect(pick(rows, "2026-01-02", "trimp_daily")).toMatchObject({ value: 0, components: { activitiesWithoutHrZones: 1 } });
  });

  it("computes zones from the HR stream when Garmin gave none (v2)", () => {
    const base = inputs(5);
    const t = Array.from({ length: 601 }, (_, i) => i);
    // A 10-minute hard session sets HR max (p99 = 200); the strength session sits at 150 = 75% → zone 3.
    base.activities = [
      { date: "2026-01-01", zoneSeconds: [0, 0, 0, 600, 0], hrStream: { timeS: t, hr: t.map(() => 200) } },
      { id: "gym", date: "2026-01-02", zoneSeconds: null, hrStream: { timeS: t, hr: t.map(() => 150) } },
      { id: "walk", date: "2026-01-02", zoneSeconds: null },
    ];
    const rows = deriveAll(base);
    expect(pick(rows, "2026-01-02", "trimp_daily")).toMatchObject({
      value: 30, // 10 min × zone 3
      components: {
        activitiesWithoutHrZones: 1,
        zonesFromHrStream: 1,
        hrMaxBpm: 200,
        // Per-activity loads, so the activity page can show a load that came from the stream.
        activities: [
          { id: "gym", load: 30, fromStream: true },
          { id: "walk", load: null, fromStream: false },
        ],
      },
    });
  });

  it("gives a stable inputs hash for identical inputs and a new one when inputs change", () => {
    const a = deriveAll(inputs(20));
    const b = deriveAll(inputs(20));
    expect(pick(a, "2026-01-20", "hrv_baseline")?.inputsHash).toBe(pick(b, "2026-01-20", "hrv_baseline")?.inputsHash);
    const changed = inputs(20);
    changed.hrv[19] = { date: "2026-01-20", value: 70 };
    expect(pick(deriveAll(changed), "2026-01-20", "hrv_baseline")?.inputsHash).not.toBe(
      pick(a, "2026-01-20", "hrv_baseline")?.inputsHash,
    );
  });

  it("scores readiness once baselines exist and lists missing parts", () => {
    const rows = deriveAll(inputs(20));
    const r = pick(rows, "2026-01-20", "readiness");
    expect(r?.value).not.toBeNull();
    expect(r?.components.missing).toContain("regularity");
  });
});
