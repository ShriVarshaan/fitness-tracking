import { addDays, daysBetween, type LocalDate } from "@ft/core";

/** One value per local date; missing days are simply absent. */
export interface DatedValue {
  date: LocalDate;
  value: number;
}

/** Result of a metric: a value with confidence, or `null` with the reason. */
export type MetricResult<T> =
  | ({ ok: true; confidence: number } & T)
  | { ok: false; reason: string };

/** Algorithm versions. Bump on any behaviour change (stored with every derived value). */
export const ALGO_VERSION = {
  hrv_baseline: 1,
  rhr_baseline: 1,
  sleep_debt: 1,
  trimp_edwards: 1,
  pmc: 1,
  acwr: 1,
  readiness: 1,
} as const;

/** Values whose date falls in [end − days + 1, end]. */
export function inWindow(series: DatedValue[], end: LocalDate, days: number): number[] {
  const start = addDays(end, -(days - 1));
  return series
    .filter((p) => daysBetween(start, p.date) >= 0 && daysBetween(p.date, end) >= 0 && Number.isFinite(p.value))
    .map((p) => p.value);
}

export function meanOf(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Sample standard deviation (n − 1). Returns 0 for fewer than two values. */
export function sampleSd(values: number[]): number {
  if (values.length < 2) return 0;
  const m = meanOf(values);
  return Math.sqrt(values.reduce((a, v) => a + (v - m) ** 2, 0) / (values.length - 1));
}

/** 0.5 at the minimum sample size, rising linearly to 1 at the full size (PLAN §6). */
export function sufficiency(n: number, min: number, full: number): number {
  if (n < min) return 0;
  if (n >= full) return 1;
  return 0.5 + (0.5 * (n - min)) / (full - min);
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
