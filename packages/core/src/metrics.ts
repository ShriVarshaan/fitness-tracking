import type { CanonicalUnit } from "./units";

/**
 * Metric registry. `comparableGroup` prevents mixing metrics that look alike
 * but aren't (e.g. HRV RMSSD vs SDNN). Seeded into `metric_definitions`.
 */
export type MetricKind = "instant" | "interval" | "daily";
export type Aggregation = "sum" | "avg" | "min" | "max" | "last";

export interface MetricDefinition {
  code: string;
  label: string;
  unit: CanonicalUnit;
  kind: MetricKind;
  agg: Aggregation;
  comparableGroup: string;
  /** True when the value is Garmin's own metric and must be labelled as Garmin's. */
  garminNative?: boolean;
}

const defs = [
  { code: "heart_rate", label: "Heart rate", unit: "bpm", kind: "instant", agg: "avg", comparableGroup: "heart_rate" },
  { code: "resting_hr", label: "Resting heart rate", unit: "bpm", kind: "daily", agg: "last", comparableGroup: "resting_hr" },
  { code: "hrv_rmssd_ms", label: "HRV (RMSSD)", unit: "ms", kind: "instant", agg: "avg", comparableGroup: "hrv_rmssd" },
  { code: "hrv_sdnn_ms", label: "HRV (SDNN)", unit: "ms", kind: "instant", agg: "avg", comparableGroup: "hrv_sdnn" },
  { code: "spo2", label: "Pulse ox (SpO2)", unit: "pct", kind: "instant", agg: "avg", comparableGroup: "spo2" },
  { code: "respiration_rate", label: "Respiration rate", unit: "count", kind: "instant", agg: "avg", comparableGroup: "respiration" },
  { code: "stress", label: "Stress", unit: "count", kind: "instant", agg: "avg", comparableGroup: "garmin_stress", garminNative: true },
  { code: "body_battery", label: "Body Battery", unit: "count", kind: "instant", agg: "last", comparableGroup: "garmin_body_battery", garminNative: true },
  { code: "steps", label: "Steps", unit: "count", kind: "interval", agg: "sum", comparableGroup: "steps" },
  { code: "distance", label: "Distance", unit: "m", kind: "interval", agg: "sum", comparableGroup: "distance" },
  { code: "active_kcal", label: "Active calories", unit: "kcal", kind: "interval", agg: "sum", comparableGroup: "active_kcal" },
  { code: "weight", label: "Weight", unit: "kg", kind: "instant", agg: "last", comparableGroup: "weight" },
  { code: "body_fat", label: "Body fat", unit: "pct", kind: "instant", agg: "last", comparableGroup: "body_fat" },
  { code: "vo2max", label: "VO2 max", unit: "count", kind: "daily", agg: "last", comparableGroup: "garmin_vo2max", garminNative: true },
  { code: "fitness_age", label: "Fitness age", unit: "count", kind: "daily", agg: "last", comparableGroup: "garmin_fitness_age", garminNative: true },
  { code: "skin_temp_delta", label: "Skin temperature change", unit: "degC", kind: "daily", agg: "avg", comparableGroup: "skin_temp_delta" },
] as const satisfies readonly MetricDefinition[];

export type MetricCode = (typeof defs)[number]["code"];

export const METRICS: Readonly<Record<MetricCode, MetricDefinition>> = Object.fromEntries(
  defs.map((d) => [d.code, d]),
) as Record<MetricCode, MetricDefinition>;

export function metric(code: MetricCode): MetricDefinition {
  return METRICS[code];
}

export function areComparable(a: MetricCode, b: MetricCode): boolean {
  return METRICS[a].comparableGroup === METRICS[b].comparableGroup;
}
