/** Display helpers. Inputs are canonical units (seconds, metres). */

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

export function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-GB", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function formatKm(metres: number | null | undefined): string {
  if (metres == null || !Number.isFinite(metres)) return "—";
  return `${(metres / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} km`;
}

/** "Mon 16 Nov" for a YYYY-MM-DD local date. */
export function formatDay(localDate: string): string {
  const d = new Date(`${localDate}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

/** Mean of the non-null values, or null if there are none. */
export function mean(values: Array<number | null | undefined>): number | null {
  const v = values.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** "Garmin calls this BALANCED" → "Balanced". */
export function titleCase(key: string | null | undefined): string {
  if (!key) return "—";
  return key
    .toLowerCase()
    .split("_")
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}
