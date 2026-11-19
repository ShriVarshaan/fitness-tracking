/**
 * Dashboard builder: the metrics a panel can chart, panel config validation,
 * weekly aggregation and the starter templates. Pure, so it can be tested.
 */
import { addDays, daysBetween } from "@ft/core";
import { weekStart } from "@ft/metrics";
import { z } from "zod";

export type Agg = "sum" | "avg" | "last";
export type Badge = "Garmin" | "Estimate" | "You entered";

export interface ChartMetric {
  code: string;
  label: string;
  /** Display unit; a panel only combines metrics with the same unit (one y-axis). */
  unit: string;
  digits: number;
  /** How days roll up into weeks. */
  weekly: Agg;
  badge: Badge;
  group: "Activity" | "Recovery" | "Sleep" | "Training load" | "Body" | "Nutrition";
}

export const CHART_METRICS: ChartMetric[] = [
  { code: "steps", label: "Steps", unit: "steps", digits: 0, weekly: "sum", badge: "Garmin", group: "Activity" },
  { code: "distance_km", label: "Distance (all day)", unit: "km", digits: 1, weekly: "sum", badge: "Garmin", group: "Activity" },
  { code: "intensity_min", label: "Intensity minutes (vigorous ×2)", unit: "min", digits: 0, weekly: "sum", badge: "Garmin", group: "Activity" },
  { code: "training_min", label: "Training time", unit: "min", digits: 0, weekly: "sum", badge: "Garmin", group: "Activity" },
  { code: "run_km", label: "Running distance", unit: "km", digits: 1, weekly: "sum", badge: "Garmin", group: "Activity" },
  { code: "ride_km", label: "Cycling distance", unit: "km", digits: 1, weekly: "sum", badge: "Garmin", group: "Activity" },
  { code: "strength_min", label: "Strength training time", unit: "min", digits: 0, weekly: "sum", badge: "Garmin", group: "Activity" },
  { code: "active_kcal", label: "Active energy", unit: "kcal", digits: 0, weekly: "avg", badge: "Garmin", group: "Activity" },
  { code: "total_kcal", label: "Total energy use", unit: "kcal", digits: 0, weekly: "avg", badge: "Garmin", group: "Activity" },
  { code: "resting_hr", label: "Resting heart rate", unit: "bpm", digits: 0, weekly: "avg", badge: "Garmin", group: "Recovery" },
  { code: "hrv", label: "Overnight HRV", unit: "ms", digits: 0, weekly: "avg", badge: "Garmin", group: "Recovery" },
  { code: "stress", label: "Stress (average)", unit: "score", digits: 0, weekly: "avg", badge: "Garmin", group: "Recovery" },
  { code: "body_battery", label: "Body Battery (high)", unit: "score", digits: 0, weekly: "avg", badge: "Garmin", group: "Recovery" },
  { code: "readiness", label: "Readiness", unit: "score", digits: 0, weekly: "avg", badge: "Estimate", group: "Recovery" },
  { code: "sleep_h", label: "Sleep", unit: "h", digits: 1, weekly: "avg", badge: "Garmin", group: "Sleep" },
  { code: "deep_h", label: "Deep sleep", unit: "h", digits: 1, weekly: "avg", badge: "Garmin", group: "Sleep" },
  { code: "rem_h", label: "REM sleep", unit: "h", digits: 1, weekly: "avg", badge: "Garmin", group: "Sleep" },
  { code: "sleep_debt_h", label: "Sleep debt (7 nights)", unit: "h", digits: 1, weekly: "last", badge: "Estimate", group: "Sleep" },
  { code: "sleep_score", label: "Sleep score", unit: "score", digits: 0, weekly: "avg", badge: "Garmin", group: "Sleep" },
  { code: "load", label: "Training load", unit: "load", digits: 0, weekly: "sum", badge: "Estimate", group: "Training load" },
  { code: "ctl", label: "Fitness (chronic load)", unit: "load", digits: 0, weekly: "last", badge: "Estimate", group: "Training load" },
  { code: "atl", label: "Fatigue (acute load)", unit: "load", digits: 0, weekly: "last", badge: "Estimate", group: "Training load" },
  { code: "tsb", label: "Form", unit: "load", digits: 0, weekly: "last", badge: "Estimate", group: "Training load" },
  { code: "vo2max", label: "VO2 max (running)", unit: "ml/kg/min", digits: 0, weekly: "last", badge: "Garmin", group: "Body" },
  { code: "weight", label: "Weight", unit: "kg", digits: 1, weekly: "avg", badge: "You entered", group: "Body" },
  { code: "body_fat", label: "Body fat", unit: "%", digits: 1, weekly: "avg", badge: "You entered", group: "Body" },
  { code: "eaten_kcal", label: "Energy eaten", unit: "kcal", digits: 0, weekly: "avg", badge: "You entered", group: "Nutrition" },
  { code: "protein_g", label: "Protein", unit: "g", digits: 0, weekly: "avg", badge: "You entered", group: "Nutrition" },
  { code: "carbs_g", label: "Carbohydrate", unit: "g", digits: 0, weekly: "avg", badge: "You entered", group: "Nutrition" },
  { code: "fat_g", label: "Fat", unit: "g", digits: 0, weekly: "avg", badge: "You entered", group: "Nutrition" },
];

export const METRIC_BY_CODE = new Map(CHART_METRICS.map((m) => [m.code, m]));
export const PERIODS = [30, 90, 182, 365] as const;

export const panelSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]{1,12}$/),
    title: z.string().trim().max(60).optional(),
    metrics: z.array(z.string().refine((c) => METRIC_BY_CODE.has(c), "unknown metric")).min(1).max(3),
    periodDays: z.union([z.literal(30), z.literal(90), z.literal(182), z.literal(365)]),
    granularity: z.enum(["day", "week"]),
    chart: z.enum(["line", "bar"]),
    /** Overlay the previous period of the same length (only with one metric). */
    compare: z.boolean(),
  })
  .refine((p) => new Set(p.metrics.map((c) => METRIC_BY_CODE.get(c)?.unit)).size === 1, "Metrics in one panel must share a unit (one y-axis).")
  .refine((p) => !p.compare || p.metrics.length === 1, "Comparing periods works with one metric.");

export type Panel = z.infer<typeof panelSchema>;
export const panelsSchema = z.array(panelSchema).max(12);

/** Days of [from, to] rolled into Monday weeks with the metric's aggregation. Weeks with no values are null. */
export function rollWeekly(values: ReadonlyMap<string, number>, from: string, to: string, agg: Agg): { weeks: string[]; values: Array<number | null> } {
  const weeks: string[] = [];
  for (let w = weekStart(from); w <= to; w = addDays(w, 7)) weeks.push(w);
  const out = weeks.map((w) => {
    const vals: number[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addDays(w, d);
      if (date < from || date > to) continue;
      const v = values.get(date);
      if (v !== undefined) vals.push(v);
    }
    if (!vals.length) return null;
    if (agg === "sum") return vals.reduce((a, b) => a + b, 0);
    if (agg === "avg") return vals.reduce((a, b) => a + b, 0) / vals.length;
    return vals.at(-1)!;
  });
  return { weeks, values: out };
}

/** The period that ends at `to` and the one before it. */
export function periodRange(to: string, days: number): { from: string; prevFrom: string; prevTo: string } {
  const from = addDays(to, -(days - 1));
  return { from, prevFrom: addDays(from, -days), prevTo: addDays(from, -1) };
}

/** Shift a series of the previous period onto the current period's dates. */
export function shiftDates(values: ReadonlyMap<string, number>, byDays: number): Map<string, number> {
  return new Map([...values].map(([d, v]) => [addDays(d, byDays), v]));
}

export const daySpan = (from: string, to: string) => daysBetween(from, to) + 1;

let counter = 0;
export function panelId(): string {
  counter = (counter + 1) % 1296;
  return (Date.now().toString(36) + counter.toString(36)).slice(-10);
}

const p = (id: string, metrics: string[], o: Partial<Panel> = {}): Panel => ({
  id,
  metrics,
  periodDays: 90,
  granularity: "week",
  chart: "line",
  compare: false,
  ...o,
});

export const DASHBOARD_TEMPLATES: Array<{ key: string; name: string; panels: Panel[] }> = [
  {
    key: "running",
    name: "Running",
    panels: [
      p("run1", ["run_km"], { chart: "bar", compare: true }),
      p("run2", ["ctl", "atl"], { granularity: "day" }),
      p("run3", ["vo2max"], { periodDays: 365, granularity: "day" }),
      p("run4", ["resting_hr"], { granularity: "day" }),
    ],
  },
  {
    key: "cycling",
    name: "Cycling",
    panels: [p("cyc1", ["ride_km"], { chart: "bar", compare: true }), p("cyc2", ["load"], { chart: "bar" }), p("cyc3", ["ctl", "atl"], { granularity: "day" })],
  },
  {
    key: "strength",
    name: "Strength",
    panels: [p("str1", ["strength_min"], { chart: "bar", compare: true }), p("str2", ["weight"], { granularity: "day", periodDays: 182 }), p("str3", ["protein_g"], { granularity: "day", periodDays: 30 })],
  },
  {
    key: "sleep-recovery",
    name: "Sleep and recovery",
    panels: [
      p("slp1", ["sleep_h", "deep_h", "rem_h"], { granularity: "day", periodDays: 30 }),
      p("slp2", ["hrv"], { granularity: "day", compare: true }),
      p("slp3", ["readiness", "body_battery"], { granularity: "day", periodDays: 30 }),
      p("slp4", ["sleep_debt_h"], { granularity: "day", periodDays: 30 }),
    ],
  },
  {
    key: "body",
    name: "Body",
    panels: [p("bod1", ["weight"], { granularity: "day", periodDays: 182 }), p("bod2", ["body_fat"], { granularity: "day", periodDays: 182 }), p("bod3", ["resting_hr"], { periodDays: 365 })],
  },
  {
    key: "nutrition",
    name: "Nutrition",
    panels: [
      p("nut1", ["eaten_kcal", "total_kcal"], { granularity: "day", periodDays: 30 }),
      p("nut2", ["protein_g", "carbs_g", "fat_g"], { granularity: "day", periodDays: 30 }),
      p("nut3", ["weight"], { granularity: "day" }),
    ],
  },
];
