/** Pure shaping helpers for the Trends page: rows → series aligned to a date axis. */
import { addDays, daysBetween } from "@ft/core";
import { weekStart } from "@ft/metrics";

export const RANGES = { "90d": 90, "6m": 182, "1y": 365 } as const;
export type RangeKey = keyof typeof RANGES;

export function parseRange(value: string | string[] | undefined): RangeKey {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v in RANGES ? (v as RangeKey) : "90d";
}

/** Every date from `from` to `to` inclusive. */
export function dateAxis(from: string, to: string): string[] {
  const n = daysBetween(from, to);
  return n < 0 ? [] : Array.from({ length: n + 1 }, (_, i) => addDays(from, i));
}

/** Values for each axis date (null where there is no row). */
export function align<T extends { local_date: string }>(axis: string[], rows: readonly T[], pick: (r: T) => number | null | undefined): Array<number | null> {
  const by = new Map<string, number>();
  for (const r of rows) {
    const v = pick(r);
    if (typeof v === "number" && Number.isFinite(v)) by.set(r.local_date, v);
  }
  return axis.map((d) => by.get(d) ?? null);
}

/** A number from a derived row's `components` JSON, or null. */
export function component(c: Record<string, unknown> | null | undefined, key: string): number | null {
  const v = c?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * WHO-weighted intensity minutes (moderate + 2 × vigorous) per Monday-based
 * week overlapping the axis. Weeks with no recorded day are null, not zero.
 */
export function weeklyIntensity(
  axis: string[],
  days: ReadonlyArray<{ local_date: string; intensity_min_moderate: number | null; intensity_min_vigorous: number | null }>,
): { weeks: string[]; minutes: Array<number | null> } {
  if (!axis.length) return { weeks: [], minutes: [] };
  const first = weekStart(axis[0]!);
  const weeks: string[] = [];
  for (let w = first; w <= axis.at(-1)!; w = addDays(w, 7)) weeks.push(w);
  const totals = new Map<string, number>();
  for (const d of days) {
    if (d.intensity_min_moderate == null && d.intensity_min_vigorous == null) continue;
    const w = weekStart(d.local_date);
    totals.set(w, (totals.get(w) ?? 0) + (d.intensity_min_moderate ?? 0) + 2 * (d.intensity_min_vigorous ?? 0));
  }
  return { weeks, minutes: weeks.map((w) => totals.get(w) ?? null) };
}

/** "03:00" for minutes after local noon (900 → 03:00). */
export function clockFromNoon(min: number): string {
  const m = Math.round(min + 12 * 60) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
