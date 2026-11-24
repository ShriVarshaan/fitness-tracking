/**
 * Weights come from the app's own log (source "manual") and from a Garmin scale
 * (source "garmin"), one row per day and source. Readers keep one per day,
 * preferring what the user entered.
 */
export function onePerDay<T extends { local_date: string; source?: string | null }>(rows: readonly T[]): T[] {
  const byDate = new Map<string, T>();
  for (const r of rows) {
    const cur = byDate.get(r.local_date);
    if (!cur || (r.source === "manual" && cur.source !== "manual")) byDate.set(r.local_date, r);
  }
  // Keep the input order (first occurrence of each date).
  const seen = new Set<string>();
  return rows.flatMap((r) => {
    if (seen.has(r.local_date)) return [];
    seen.add(r.local_date);
    return [byDate.get(r.local_date)!];
  });
}

/** Badge text for a set of weight rows. */
export function weightBadge(rows: ReadonlyArray<{ source?: string | null }>): string {
  const sources = new Set(rows.map((r) => r.source));
  if (sources.has("garmin") && sources.has("manual")) return "Garmin and you";
  return sources.has("garmin") ? "Garmin" : "You entered";
}
