/**
 * Where measured values came from, for labels. Garmin (API or account export)
 * and Apple Health both supply steps, resting heart rate, sleep and workouts;
 * HRV, stress, Body Battery and sleep scores only ever come from Garmin.
 * Demo data imitates Garmin and is labelled as demo elsewhere.
 */
export function vendorLabel(sources: Iterable<string | null | undefined>): string {
  const set = new Set<string>();
  for (const s of sources) set.add(s === "apple_health" ? "Apple Health" : "Garmin");
  if (set.size === 0) return "Garmin";
  return [...set].sort().reverse().join(" and ");
}
