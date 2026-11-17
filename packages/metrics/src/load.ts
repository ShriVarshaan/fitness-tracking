import { addDays, daysBetween, type LocalDate } from "@ft/core";

/**
 * Edwards summated-zone TRIMP: Σ minutes in zone × zone number (1–5).
 * Edwards 1993, The Heart Rate Monitor Book. v1 uses Garmin's per-activity
 * HR zone times (zones as configured in Garmin). Returns null without zone data.
 */
export function edwardsTrimp(zoneSeconds: readonly number[] | null | undefined): number | null {
  if (!zoneSeconds || zoneSeconds.length !== 5) return null;
  if (zoneSeconds.every((s) => !(s > 0))) return null;
  return zoneSeconds.reduce((sum, s, i) => sum + (Math.max(0, s) / 60) * (i + 1), 0);
}

/** Edwards' zone bands as fractions of HR max (zone 1 = 50–60% … zone 5 = 90–100%). */
const EDWARDS_BANDS = [0.5, 0.6, 0.7, 0.8, 0.9] as const;
/** Longest gap (s) one HR sample is allowed to stand for. */
const MAX_SAMPLE_S = 10;

/**
 * Seconds in each Edwards zone from a per-second HR stream. Each sample counts
 * for the time until the next one (capped at 10 s); below 50% of HR max counts
 * for nothing. Edwards 1993. Returns null without usable samples.
 */
export function edwardsZonesFromHr(timeS: readonly number[], hr: ReadonlyArray<number | null>, hrMax: number): number[] | null {
  if (!(hrMax > 0) || timeS.length < 2) return null;
  const zones = [0, 0, 0, 0, 0];
  let used = 0;
  for (let i = 0; i < timeS.length - 1; i++) {
    const h = hr[i];
    if (h == null || !(h > 0)) continue;
    const dt = Math.min(MAX_SAMPLE_S, Math.max(0, timeS[i + 1]! - timeS[i]!));
    const f = h / hrMax;
    for (let z = 4; z >= 0; z--) {
      if (f >= EDWARDS_BANDS[z]!) {
        zones[z]! += dt;
        used++;
        break;
      }
    }
  }
  return used > 0 ? zones : null;
}

/**
 * HR max estimate: the highest per-activity 99th-percentile heart rate
 * (robust to single-sample spikes). docs/PLAN.md §6.
 */
export function hrMaxFromActivities(streams: ReadonlyArray<ReadonlyArray<number | null>>): number | null {
  let best: number | null = null;
  for (const s of streams) {
    const v = s.filter((x): x is number => x != null && x > 30 && x < 250).sort((a, b) => a - b);
    if (v.length < 60) continue; // under a minute of data
    const p99 = v[Math.ceil(v.length * 0.99) - 1]!;
    if (best === null || p99 > best) best = p99;
  }
  return best;
}

/**
 * One activity's Edwards TRIMP: Garmin's zone times when present, otherwise
 * zones computed from the activity's HR stream against the estimated HR max (v2).
 */
export function activityTrimp(
  a: { zoneSeconds: readonly number[] | null; hrStream?: { timeS: number[]; hr: Array<number | null> } | null },
  hrMax: number | null,
): { value: number | null; fromStream: boolean } {
  if (a.zoneSeconds) return { value: edwardsTrimp(a.zoneSeconds), fromStream: false };
  if (a.hrStream && hrMax) {
    const zones = edwardsZonesFromHr(a.hrStream.timeS, a.hrStream.hr, hrMax);
    if (zones) return { value: edwardsTrimp(zones), fromStream: true };
  }
  return { value: null, fromStream: false };
}

export interface PmcDay {
  date: LocalDate;
  load: number;
  /** Chronic training load ("fitness"): EWMA, τ = 42 days. */
  ctl: number;
  /** Acute training load ("fatigue"): EWMA, τ = 7 days. */
  atl: number;
  /** Form = yesterday's CTL − yesterday's ATL. */
  tsb: number;
  /** Days of history behind this value / 42, capped at 1. */
  confidence: number;
}

const CTL_TAU = 42;
const ATL_TAU = 7;

/**
 * Fitness / fatigue / form (Banister impulse-response model, Coggan's
 * Performance Manager): x_t = x_{t−1} + (L_t − x_{t−1})(1 − e^(−1/τ)).
 * Days with no recorded activity count as zero load. Starts from 0 on `from`.
 */
export function pmc(dailyLoad: ReadonlyMap<LocalDate, number>, from: LocalDate, to: LocalDate): PmcDay[] {
  const kCtl = 1 - Math.exp(-1 / CTL_TAU);
  const kAtl = 1 - Math.exp(-1 / ATL_TAU);
  const out: PmcDay[] = [];
  let ctl = 0;
  let atl = 0;
  const days = daysBetween(from, to);
  for (let i = 0; i <= days; i++) {
    const date = addDays(from, i);
    const load = dailyLoad.get(date) ?? 0;
    const tsb = ctl - atl; // yesterday's values
    ctl += (load - ctl) * kCtl;
    atl += (load - atl) * kAtl;
    out.push({ date, load, ctl, atl, tsb, confidence: Math.min(1, (i + 1) / CTL_TAU) });
  }
  return out;
}

export interface AcwrDay {
  date: LocalDate;
  acute: number;
  chronic: number;
  /** acute / chronic; null until 28 days of history or while chronic load is ~0. */
  ratio: number | null;
}

/**
 * EWMA acute:chronic workload ratio, λa = 2/(7+1), λc = 2/(28+1).
 * Williams et al. 2017, BJSM 51:209–210. Descriptive "load spike" indicator only;
 * NOT an injury predictor (Impellizzeri et al. 2020, IJSPP 15:907–913).
 */
export function acwr(dailyLoad: ReadonlyMap<LocalDate, number>, from: LocalDate, to: LocalDate): AcwrDay[] {
  const la = 2 / (7 + 1);
  const lc = 2 / (28 + 1);
  const out: AcwrDay[] = [];
  let acute = 0;
  let chronic = 0;
  const days = daysBetween(from, to);
  for (let i = 0; i <= days; i++) {
    const date = addDays(from, i);
    const load = dailyLoad.get(date) ?? 0;
    acute = load * la + (1 - la) * acute;
    chronic = load * lc + (1 - lc) * chronic;
    out.push({ date, acute, chronic, ratio: i + 1 >= 28 && chronic > 1 ? acute / chronic : null });
  }
  return out;
}
