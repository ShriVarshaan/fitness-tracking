/** Helpers for per-second activity streams (time_s aligned arrays, nulls = no reading). */

export type Series = Array<number | null>;

/**
 * Reduce to at most `maxPoints` by averaging fixed-size buckets.
 * Buckets with no readings stay null, so gaps survive.
 */
export function downsample(time: number[], values: Series, maxPoints: number): { t: number[]; v: Series } {
  if (time.length <= maxPoints) return { t: time, v: values };
  const size = Math.ceil(time.length / maxPoints);
  const t: number[] = [];
  const v: Series = [];
  for (let i = 0; i < time.length; i += size) {
    const slice = values.slice(i, i + size).filter((x): x is number => x !== null && Number.isFinite(x));
    t.push(time[Math.min(i + Math.floor(size / 2), time.length - 1)]!);
    v.push(slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : null);
  }
  return { t, v };
}

/** Speed (m/s) → pace (seconds per km). Very slow or stopped readings become null. */
export function toPace(speed: Series): Series {
  return speed.map((s) => (s !== null && s > 0.8 ? 1000 / s : null));
}

/** Format seconds per km as m:ss. */
export function formatPace(secPerKm: number): string {
  const s = Math.round(secPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Format elapsed seconds as h:mm:ss or m:ss. */
export function formatElapsed(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** "benchPress" → "Bench press". */
export function exerciseName(key: string | null): string {
  if (!key) return "Unknown exercise";
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Robust min/max ignoring nulls and the most extreme 1% at each end (GPS and HR spikes). */
export function robustRange(values: Series): { min: number; max: number } | null {
  const v = values.filter((x): x is number => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length < 2) return null;
  const lo = v[Math.floor(v.length * 0.01)]!;
  const hi = v[Math.ceil(v.length * 0.99) - 1]!;
  return lo === hi ? { min: lo - 1, max: hi + 1 } : { min: lo, max: hi };
}
