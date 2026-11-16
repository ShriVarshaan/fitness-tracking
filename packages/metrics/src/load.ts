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
