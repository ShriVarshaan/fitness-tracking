import type { LocalDate } from "@ft/core";
import { inWindow, type DatedValue, type MetricResult } from "./common";

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
