import type { LocalDate } from "@ft/core";
import { inWindow, meanOf, sampleSd, sufficiency, type DatedValue, type MetricResult } from "./common";

const BASELINE_DAYS = 60;
const ROLLING_DAYS = 7;
const MIN_BASELINE = 14;
const FULL_BASELINE = 30;
const MIN_ROLLING = 3;
/** Below this, the spread is floating-point noise: treat SD as zero. */
const SD_EPSILON = 1e-9;

export interface HrvBaseline {
  /** 7-day rolling mean, back-transformed to ms (geometric mean of RMSSD). */
  rollingMs: number;
  baselineMs: number;
  /** Normal band = baseline ± 0.5 SD in ln space, back-transformed to ms. */
  bandLowMs: number;
  bandHighMs: number;
  /** (7-day ln mean − baseline ln mean) / ln SD; 0 when SD is 0. */
  z: number;
  nights: number;
}

/**
 * HRV baseline and deviation from overnight RMSSD.
 *
 * ln(RMSSD), 7-day rolling mean vs a 60-day baseline mean ± 0.5 SD (smallest
 * worthwhile change). Plews et al. 2012, Eur J Appl Physiol 112:3729–3741;
 * Plews et al. 2013, Sports Med 43:773–781; Buchheit 2014, Front Physiol 5:73.
 * RMSSD only: never pass SDNN values here.
 */
export function hrvBaseline(nights: DatedValue[], date: LocalDate): MetricResult<HrvBaseline> {
  const valid = nights.filter((n) => n.value > 0).map((n) => ({ date: n.date, value: Math.log(n.value) }));
  const base = inWindow(valid, date, BASELINE_DAYS);
  if (base.length < MIN_BASELINE) {
    return { ok: false, reason: `needs ${MIN_BASELINE} nights of HRV in the last ${BASELINE_DAYS} days; has ${base.length}` };
  }
  const rolling = inWindow(valid, date, ROLLING_DAYS);
  if (rolling.length < MIN_ROLLING) {
    return { ok: false, reason: `needs ${MIN_ROLLING} nights of HRV in the last ${ROLLING_DAYS} days; has ${rolling.length}` };
  }
  const mean = meanOf(base);
  const sd = sampleSd(base);
  const roll = meanOf(rolling);
  return {
    ok: true,
    confidence: sufficiency(base.length, MIN_BASELINE, FULL_BASELINE),
    rollingMs: Math.exp(roll),
    baselineMs: Math.exp(mean),
    bandLowMs: Math.exp(mean - 0.5 * sd),
    bandHighMs: Math.exp(mean + 0.5 * sd),
    z: sd > SD_EPSILON ? (roll - mean) / sd : 0,
    nights: base.length,
  };
}

export interface RhrBaseline {
  rollingBpm: number;
  baselineBpm: number;
  sdBpm: number;
  /** Threshold for "elevated": baseline + max(5 bpm, 2 SD). */
  elevatedAboveBpm: number;
  days: number;
}

/**
 * Resting heart rate trend: 7-day mean vs a 60-day baseline (mean, sample SD).
 * Buchheit 2014, Front Physiol 5:73. Elevated threshold per docs/PLAN.md §6.
 */
export function rhrBaseline(days: DatedValue[], date: LocalDate): MetricResult<RhrBaseline> {
  const valid = days.filter((d) => d.value > 0);
  const base = inWindow(valid, date, BASELINE_DAYS);
  if (base.length < MIN_BASELINE) {
    return { ok: false, reason: `needs ${MIN_BASELINE} days of resting HR in the last ${BASELINE_DAYS} days; has ${base.length}` };
  }
  const rolling = inWindow(valid, date, ROLLING_DAYS);
  if (rolling.length < MIN_ROLLING) {
    return { ok: false, reason: `needs ${MIN_ROLLING} days of resting HR in the last ${ROLLING_DAYS} days; has ${rolling.length}` };
  }
  const mean = meanOf(base);
  const sd = sampleSd(base);
  return {
    ok: true,
    confidence: sufficiency(base.length, MIN_BASELINE, FULL_BASELINE),
    rollingBpm: meanOf(rolling),
    baselineBpm: mean,
    sdBpm: sd,
    elevatedAboveBpm: mean + Math.max(5, 2 * sd),
    days: base.length,
  };
}
