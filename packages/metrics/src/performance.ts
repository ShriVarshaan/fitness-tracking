import type { MetricResult } from "./common";

/**
 * Performance estimates from per-second activity streams: best efforts, critical
 * speed / power and a race predictor. Pure functions; formulas in docs/PLAN.md §6.
 */

/** Seconds per sample are capped at this, so a paused watch doesn't count as effort. */
const MAX_GAP_S = 10;

/** A series of (elapsed seconds, value) points from one activity. */
export interface ActivityTrace {
  id: string;
  date: string;
  timeS: readonly number[];
  values: readonly (number | null)[];
}

/**
 * Fastest time to cover each target distance anywhere inside one activity, from
 * the cumulative distance stream (m). Interpolates between samples; a target the
 * activity never covers is absent. Two-pointer scan, O(n) per target.
 */
export function bestEffortTimes(timeS: readonly number[], distanceM: readonly (number | null)[], targetsM: readonly number[]): Map<number, number> {
  const t: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < timeS.length; i++) {
    const di = distanceM[i];
    if (typeof di !== "number" || !Number.isFinite(di)) continue;
    // Distance must not go backwards (FIT distance is cumulative); skip glitches.
    if (d.length && di < d[d.length - 1]!) continue;
    t.push(timeS[i]!);
    d.push(di);
  }
  const out = new Map<number, number>();
  if (d.length < 2) return out;
  for (const target of targetsM) {
    if (d[d.length - 1]! - d[0]! < target) continue;
    let best = Infinity;
    let j = 0;
    for (let i = 0; i < d.length; i++) {
      // Smallest j > i with d[j] − d[i] ≥ target.
      if (j <= i) j = i + 1;
      while (j < d.length && d[j]! - d[i]! < target) j++;
      if (j >= d.length) break;
      // Interpolate the exact moment the target is reached between j − 1 and j.
      const span = d[j]! - d[j - 1]!;
      const frac = span > 0 ? (d[i]! + target - d[j - 1]!) / span : 1;
      const tEnd = t[j - 1]! + frac * (t[j]! - t[j - 1]!);
      best = Math.min(best, tEnd - t[i]!);
    }
    if (Number.isFinite(best) && best > 0) out.set(target, best);
  }
  return out;
}

/**
 * Mean-maximal values for each duration: the highest time-weighted average of the
 * series over any window of that many seconds (for power, mean-maximal power).
 * Samples carry the value until the next sample, capped at 10 s; missing values
 * count as zero. A duration longer than the activity is absent.
 */
export function meanMaximal(timeS: readonly number[], values: readonly (number | null)[], durationsS: readonly number[]): Map<number, number> {
  // Cumulative integral at each sample time, with gaps capped.
  const n = timeS.length;
  const out = new Map<number, number>();
  if (n < 2) return out;
  // Effective (gap-capped) clock, so a long pause shortens the window rather than diluting it.
  const clock: number[] = [0];
  const area: number[] = [0];
  for (let i = 1; i < n; i++) {
    const dt = Math.min(MAX_GAP_S, Math.max(0, timeS[i]! - timeS[i - 1]!));
    const v = values[i - 1];
    clock.push(clock[i - 1]! + dt);
    area.push(area[i - 1]! + dt * (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0));
  }
  for (const dur of durationsS) {
    if (clock[n - 1]! < dur) continue;
    let best = -Infinity;
    let j = 0;
    for (let i = 0; i < n; i++) {
      if (j < i) j = i;
      while (j < n && clock[j]! - clock[i]! < dur) j++;
      if (j >= n) break;
      // Window [clock[i], clock[i] + dur]: interpolate the integral at the end.
      const segT = clock[j]! - clock[j - 1]!;
      const frac = segT > 0 ? (clock[i]! + dur - clock[j - 1]!) / segT : 1;
      const endArea = area[j - 1]! + frac * (area[j]! - area[j - 1]!);
      best = Math.max(best, (endArea - area[i]!) / dur);
    }
    if (Number.isFinite(best)) out.set(dur, best);
  }
  return out;
}

/** A best value and the activity it came from. */
export interface BestPoint {
  /** Duration in seconds (critical power / speed) or distance in metres (best efforts). */
  key: number;
  value: number;
  activityId: string;
  date: string;
}

/** Combine per-activity maps into the best value per key across activities (max, or min for times). */
export function bestAcross(perActivity: ReadonlyArray<{ id: string; date: string; values: Map<number, number> }>, pick: "max" | "min"): BestPoint[] {
  const best = new Map<number, BestPoint>();
  for (const a of perActivity) {
    for (const [key, value] of a.values) {
      const cur = best.get(key);
      if (!cur || (pick === "max" ? value > cur.value : value < cur.value)) best.set(key, { key, value, activityId: a.id, date: a.date });
    }
  }
  return [...best.values()].sort((x, y) => x.key - y.key);
}

/** Durations used for the critical speed / power fit: 3, 5, 10 and 20 minutes. */
export const CRITICAL_DURATIONS_S = [180, 300, 600, 1200] as const;

export interface CriticalFit {
  /** Critical speed (m/s) or critical power (W). */
  critical: number;
  /** D′ (m) or W′ (J): the finite work capacity above the critical value. */
  reserve: number;
  r2: number;
  points: number;
}

/** Ordinary least squares y = a·x + b, with R². */
function linearFit(xs: number[], ys: number[]): { slope: number; intercept: number; r2: number } {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) ** 2;
    syy += (ys[i]! - my) ** 2;
  }
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = syy > 0 ? (sxy * sxy) / (sxx * syy) : 1;
  return { slope, intercept, r2 };
}

/**
 * Critical speed / critical power from the linear work–time model: total work
 * (distance, or power × time) = critical × t + reserve, fitted by least squares
 * over best efforts of 3–20 minutes. Monod & Scherrer 1965, Ergonomics 8:329–338;
 * Jones et al. 2010, Med Sci Sports Exerc 42:1876–1890.
 *
 * Input: best average speed (m/s) or power (W) per duration (s). Needs at least
 * 3 of the 4 durations. A fit with a non-positive slope or intercept means the
 * efforts weren't maximal, so no value is given. Confidence is a heuristic
 * (unvalidated): share of the 4 durations present × fit quality (1 at R² ≥ 0.99,
 * 0.75 at ≥ 0.97, else 0.5).
 */
export function criticalFit(best: ReadonlyArray<{ durationS: number; average: number }>): MetricResult<CriticalFit> {
  const pts = best.filter((p) => p.durationS >= 120 && p.durationS <= 1500 && p.average > 0);
  if (pts.length < 3) return { ok: false, reason: `needs best efforts at 3 of 3, 5, 10 and 20 minutes; has ${pts.length}` };
  const fit = linearFit(
    pts.map((p) => p.durationS),
    pts.map((p) => p.average * p.durationS),
  );
  if (!(fit.slope > 0) || !(fit.intercept > 0)) {
    return { ok: false, reason: "your best efforts at different lengths don't look like all-out efforts yet" };
  }
  const quality = fit.r2 >= 0.99 ? 1 : fit.r2 >= 0.97 ? 0.75 : 0.5;
  return {
    ok: true,
    confidence: Math.min(1, pts.length / CRITICAL_DURATIONS_S.length) * quality,
    critical: fit.slope,
    reserve: fit.intercept,
    r2: fit.r2,
    points: pts.length,
  };
}

/** Race distances (m) for best efforts and predictions. */
export const RACE_DISTANCES = [
  { key: "1k", label: "1 km", m: 1000 },
  { key: "mile", label: "1 mile", m: 1609.344 },
  { key: "5k", label: "5 km", m: 5000 },
  { key: "10k", label: "10 km", m: 10_000 },
  { key: "half", label: "Half marathon", m: 21_097.5 },
  { key: "marathon", label: "Marathon", m: 42_195 },
] as const;

export const RIEGEL_EXPONENT = 1.06;
/** Efforts shorter than this predict long races poorly (they are too anaerobic). */
export const PREDICTOR_MIN_SOURCE_M = 3000;
/** Never extrapolate more than this many times the source distance, either way. */
export const PREDICTOR_MAX_RATIO = 5;

export interface RacePrediction {
  targetM: number;
  timeS: number;
  /** The best effort the prediction is based on. */
  from: BestPoint;
}

/**
 * Riegel's endurance model: T₂ = T₁ × (D₂ / D₁)^1.06 (Riegel 1981, American
 * Scientist 69:285–290). For each target, uses the best effort (≥ 3 km) whose
 * distance is closest to the target on a log scale, and never extrapolates more
 * than 5 times the distance. Confidence (heuristic, unvalidated) falls with the
 * gap: 1 / (1 + |ln(D₂ / D₁)|), so the same distance is 1 and double is about 0.6.
 * Training best efforts are rarely all-out, so predictions err on the slow side.
 */
export function predictRace(targetM: number, bests: readonly BestPoint[]): MetricResult<RacePrediction> {
  const usable = bests.filter((b) => b.key >= PREDICTOR_MIN_SOURCE_M && b.value > 0);
  if (!usable.length) return { ok: false, reason: "needs a best effort of at least 3 km" };
  const from = usable.reduce((a, b) => (Math.abs(Math.log(targetM / b.key)) < Math.abs(Math.log(targetM / a.key)) ? b : a));
  const ratio = targetM / from.key;
  if (ratio > PREDICTOR_MAX_RATIO || ratio < 1 / PREDICTOR_MAX_RATIO) {
    return { ok: false, reason: `the nearest best effort (${Math.round(from.key)} m) is too far from this distance` };
  }
  return {
    ok: true,
    confidence: 1 / (1 + Math.abs(Math.log(ratio))),
    targetM,
    timeS: from.value * ratio ** RIEGEL_EXPONENT,
    from,
  };
}
