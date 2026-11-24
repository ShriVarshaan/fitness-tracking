/**
 * Weights come from the app's own log (source "manual"), a Garmin scale
 * ("garmin") and Apple Health ("apple_health"), one row per day and source.
 * Readers keep one per day: what the user entered, then Garmin, then Apple.
 */
const RANK: Record<string, number> = { manual: 0, garmin: 1, apple_health: 2 };
const rank = (s: string | null | undefined) => RANK[s ?? ""] ?? 3;

export function onePerDay<T extends { local_date: string; source?: string | null }>(rows: readonly T[]): T[] {
  const byDate = new Map<string, T>();
  for (const r of rows) {
    const cur = byDate.get(r.local_date);
    if (!cur || rank(r.source) < rank(cur.source)) byDate.set(r.local_date, r);
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
  const names = [...new Set(rows.map((r) => r.source))]
    .sort((a, b) => rank(a) - rank(b))
    .map((s) => (s === "manual" ? "you" : s === "garmin" ? "Garmin" : s === "apple_health" ? "Apple Health" : "other"));
  if (names.length === 1 && names[0] === "you") return "You entered";
  const label = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : (names[0] ?? "");
  return label.charAt(0).toUpperCase() + label.slice(1);
}
