import { addDays, daysBetween, type LocalDate } from "@ft/core";
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

/** One night's asleep intervals (epoch ms), dated to the morning of waking. */
export interface SleepNightIntervals {
  date: LocalDate;
  /** The night's UTC offset in minutes (null = UTC). */
  tzOffsetMin: number | null;
  /** Asleep intervals [start, end) in epoch ms. */
  asleep: Array<[number, number]>;
  /**
   * True when the intervals come from sleep stages (wake-ups inside the night
   * count as awake); false when only the sleep start and end are known.
   */
  fromStages: boolean;
}

export const SRI_WINDOW_DAYS = 14;
export const SRI_MIN_PAIRS = 5;
export const SRI_FULL_PAIRS = 13;
/** Confidence factor when any night only has its start and end times (heuristic). */
export const SRI_APPROXIMATE_FACTOR = 0.6;

export interface SleepRegularity {
  /** Sleep Regularity Index, −100 to 100 (100 = identical timing every day). */
  sri: number;
  /** Pairs of consecutive days compared. */
  pairs: number;
  /** Some nights had only start and end times, so wake-ups inside them were not seen. */
  approximate: boolean;
}

/**
 * Minute-by-minute sleep (true) / wake (false) for the local noon-to-noon day
 * ending at noon on the night's wake date, in the night's own UTC offset.
 */
export function sleepWakeMinutes(night: SleepNightIntervals): boolean[] {
  const start = Date.parse(`${addDays(night.date, -1)}T12:00:00Z`) - (night.tzOffsetMin ?? 0) * 60_000;
  const out = new Array<boolean>(1440).fill(false);
  for (const [a, b] of night.asleep) {
    // A minute is asleep when its midpoint falls inside an asleep interval.
    const from = Math.max(0, Math.ceil((a - start) / 60_000 - 0.5));
    const to = Math.min(1440, Math.ceil((b - start) / 60_000 - 0.5));
    for (let m = from; m < to; m++) out[m] = true;
  }
  return out;
}

/**
 * Sleep Regularity Index: the chance of being in the same state (asleep or
 * awake) at any two times 24 hours apart, scaled to −100…100:
 * SRI = −100 + 200 × (minutes in agreement ÷ minutes compared), over pairs of
 * consecutive days in the last 14 (Phillips et al. 2017, Scientific Reports
 * 7:3216). Days run noon to noon in the night's own time zone. Days without a
 * recorded night are left out rather than counted as awake. Needs 5 pairs;
 * confidence 0.5 at 5 rising to 1 at 13, times 0.6 when some nights only have
 * start and end times (a heuristic, unvalidated: wake-ups inside those nights
 * are invisible, which overstates regularity).
 */
export function sleepRegularityIndex(nights: readonly SleepNightIntervals[], date: LocalDate): MetricResult<SleepRegularity> {
  // One night per date in the window: the one with the most asleep time.
  const total = (n: SleepNightIntervals) => n.asleep.reduce((t, [a, b]) => t + (b - a), 0);
  const byDate = new Map<LocalDate, SleepNightIntervals>();
  for (const n of nights) {
    const ago = daysBetween(n.date, date);
    if (ago < 0 || ago >= SRI_WINDOW_DAYS || n.asleep.length === 0) continue;
    const cur = byDate.get(n.date);
    if (!cur || total(n) > total(cur)) byDate.set(n.date, n);
  }
  const minutes = new Map<LocalDate, boolean[]>();
  const getMinutes = (n: SleepNightIntervals) => {
    let m = minutes.get(n.date);
    if (!m) minutes.set(n.date, (m = sleepWakeMinutes(n)));
    return m;
  };
  let agree = 0;
  let pairs = 0;
  let approximate = false;
  for (const [d, night] of byDate) {
    const next = byDate.get(addDays(d, 1));
    if (!next) continue;
    const a = getMinutes(night);
    const b = getMinutes(next);
    for (let m = 0; m < 1440; m++) if (a[m] === b[m]) agree++;
    pairs++;
    if (!night.fromStages || !next.fromStages) approximate = true;
  }
  if (pairs < SRI_MIN_PAIRS) {
    return { ok: false, reason: `needs ${SRI_MIN_PAIRS} pairs of consecutive recorded nights in the last ${SRI_WINDOW_DAYS} days; has ${pairs}` };
  }
  return {
    ok: true,
    confidence: sufficiency(pairs, SRI_MIN_PAIRS, SRI_FULL_PAIRS) * (approximate ? SRI_APPROXIMATE_FACTOR : 1),
    sri: -100 + (200 * agree) / (pairs * 1440),
    pairs,
    approximate,
  };
}
