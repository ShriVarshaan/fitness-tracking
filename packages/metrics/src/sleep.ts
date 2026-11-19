import type { LocalDate } from "@ft/core";
import { inWindow, meanOf, sampleSd, sufficiency, type DatedValue, type MetricResult } from "./common";

const WINDOW = 7;
const MIN_NIGHTS = 3;

export interface SleepDebt {
  /** Seconds of sleep short of need, summed over recorded nights in the last 7. */
  debtS: number;
  nights: number;
}

/**
 * Sleep debt = Σ max(0, need − actual) over the last 7 nights. Nights with no
 * record are skipped (not counted as zero sleep). Need defaults to 8 h.
 * Hirshkowitz et al. 2015, Sleep Health 1:40–43; Watson et al. 2015, Sleep 38:843–844.
 */
export function sleepDebt(nights: DatedValue[], date: LocalDate, needS: number): MetricResult<SleepDebt> {
  if (!(needS > 0)) return { ok: false, reason: "sleep need is not set" };
  const recorded = inWindow(
    nights.filter((n) => n.value > 0),
    date,
    WINDOW,
  );
  if (recorded.length < MIN_NIGHTS) {
    return { ok: false, reason: `needs ${MIN_NIGHTS} recorded nights in the last ${WINDOW}; has ${recorded.length}` };
  }
  return {
    ok: true,
    confidence: recorded.length / WINDOW,
    debtS: recorded.reduce((sum, actual) => sum + Math.max(0, needS - actual), 0),
    nights: recorded.length,
  };
}

/** Minutes after local noon (0–1439) for an instant and its UTC offset, so a night never wraps at midnight. */
export function minutesAfterNoon(instant: string, tzOffsetMin: number | null): number {
  const local = Date.parse(instant) / 60_000 + (tzOffsetMin ?? 0);
  return (((local - 12 * 60) % 1440) + 1440) % 1440;
}

export interface SleepNightTiming {
  /** Sleep start and end instants (ISO) and the night's UTC offset in minutes. */
  start: string;
  end: string;
  tzOffsetMin: number | null;
}

export interface MidpointVariability {
  /** Sample SD of the sleep midpoint, in minutes. */
  sdMin: number;
  /** Mean midpoint, minutes after local noon (e.g. 900 = 03:00). */
  meanMidpointMin: number;
  nights: number;
}

const MIDPOINT_MIN_NIGHTS = 5;
const MIDPOINT_FULL_NIGHTS = 14;

/**
 * Sleep timing variability: the sample SD of the nightly sleep midpoint (local
 * clock time, measured from noon so 23:00 and 01:00 are 2 h apart). A simple
 * regularity measure that Phillips et al. 2017 (Sci Rep 7:3216) report alongside
 * the Sleep Regularity Index. Needs 5 nights; confidence 0.5 at 5 rising to 1 at 14.
 */
export function sleepMidpointVariability(nights: readonly SleepNightTiming[]): MetricResult<MidpointVariability> {
  const mids = nights
    .filter((n) => Date.parse(n.end) > Date.parse(n.start))
    .map((n) => {
      const start = minutesAfterNoon(n.start, n.tzOffsetMin);
      const lengthMin = (Date.parse(n.end) - Date.parse(n.start)) / 60_000;
      return start + lengthMin / 2;
    });
  if (mids.length < MIDPOINT_MIN_NIGHTS) {
    return { ok: false, reason: `needs ${MIDPOINT_MIN_NIGHTS} nights with sleep times; has ${mids.length}` };
  }
  return {
    ok: true,
    confidence: sufficiency(mids.length, MIDPOINT_MIN_NIGHTS, MIDPOINT_FULL_NIGHTS),
    sdMin: sampleSd(mids),
    meanMidpointMin: meanOf(mids),
    nights: mids.length,
  };
}
