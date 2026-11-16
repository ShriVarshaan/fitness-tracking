import type { Evidence } from "@ft/metrics";

export function duration(seconds: number): string {
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** How an evidence value is written in text. The grounding check uses the same function. */
export function formatValue(value: number, unit: string): string {
  switch (unit) {
    case "s":
      return duration(value);
    case "ms":
    case "bpm":
      return `${Math.round(value)} ${unit}`;
    case "%":
      return `${Math.round(value * 10) / 10}%`;
    case "ratio":
      return value.toFixed(2);
    case "nights":
      return `${value} night${value === 1 ? "" : "s"}`;
    case "sessions":
      return `${value} session${value === 1 ? "" : "s"}`;
    case "steps":
      return `${Math.round(value).toLocaleString("en-GB")} steps`;
    case "min":
      return `${Math.round(value)} min`;
    case "load":
      return `${Math.round(value)}`;
    default:
      return `${Math.round(value * 10) / 10}`;
  }
}

export const fmt = (e: Evidence) => formatValue(e.value, e.unit);
export const fmtBaseline = (e: Evidence) => (e.baseline === undefined ? "" : formatValue(e.baseline, e.unit));
