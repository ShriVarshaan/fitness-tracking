/** Display helpers for activities. */

/** Garmin type keys → readable names ("strength_training" → "Strength training", "tennis_v2" → "Tennis"). */
export function sportName(typeKey: string): string {
  const clean = typeKey.replace(/_v\d+$/, "").replace(/_/g, " ");
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/** Pace in min:ss per km from metres per second; null for non-moving activities. */
export function pacePerKm(speedMps: number | null | undefined): string | null {
  if (!speedMps || speedMps <= 0.5) return null;
  const secPerKm = Math.round(1000 / speedMps);
  return `${Math.floor(secPerKm / 60)}:${String(secPerKm % 60).padStart(2, "0")} /km`;
}

/** Sports where pace is the natural measure. */
export function usesPace(sport: string): boolean {
  return /running|walking|hiking|trail/.test(sport);
}

export function isCycling(sport: string): boolean {
  return /cycling|biking|ride/.test(sport);
}

/**
 * One activity's load from the day's `trimp_daily` components (written by
 * deriveAll): `{ activities: [{ id, load, fromStream }], hrMaxBpm? }`.
 */
export function activityLoad(
  components: unknown,
  id: string,
): { load: number | null; fromStream: boolean; hrMaxBpm: number | null } | null {
  if (!components || typeof components !== "object") return null;
  const c = components as { activities?: unknown; hrMaxBpm?: unknown };
  if (!Array.isArray(c.activities)) return null;
  const hit = c.activities.find((x): x is { id: string; load: number | null; fromStream: boolean } => !!x && typeof x === "object" && x.id === id);
  if (!hit) return null;
  return {
    load: typeof hit.load === "number" ? hit.load : null,
    fromStream: hit.fromStream === true,
    hrMaxBpm: typeof c.hrMaxBpm === "number" ? c.hrMaxBpm : null,
  };
}
