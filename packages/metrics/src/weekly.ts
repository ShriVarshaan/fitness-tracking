import { addDays, daysBetween, type LocalDate } from "@ft/core";
import { r1, type Evidence } from "./rules/types";

/** Weeks run Monday to Sunday. */
export function weekStart(date: LocalDate): LocalDate {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((dow + 6) % 7));
}

export interface WeeklyInputs {
  sleepNeedS: number;
  sleep: ReadonlyMap<LocalDate, number>;
  hrv: ReadonlyMap<LocalDate, number>;
  rhr: ReadonlyMap<LocalDate, number>;
  steps: ReadonlyMap<LocalDate, number>;
  /** Moderate + vigorous intensity minutes per day (WHO counts vigorous double). */
  intensity: ReadonlyMap<LocalDate, { moderate: number; vigorous: number }>;
  activities: ReadonlyArray<{ date: LocalDate; durationS: number | null }>;
  /** Our daily training load (Edwards TRIMP). */
  load: ReadonlyMap<LocalDate, number>;
}

export interface WeekStats {
  start: LocalDate;
  end: LocalDate;
  /** Days of the week covered so far (7 for a complete week). */
  daysElapsed: number;
  sessions: number;
  trainingS: number;
  load: number;
  sleepAvgS: number | null;
  sleepNights: number;
  hrvAvgMs: number | null;
  rhrAvgBpm: number | null;
  stepsAvg: number | null;
  /** WHO-weighted intensity minutes: moderate + 2 × vigorous. */
  intensityMin: number;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Totals and averages for the Monday–Sunday week starting `start`, up to `asOf`. */
export function weekStats(inputs: WeeklyInputs, start: LocalDate, asOf: LocalDate): WeekStats {
  const end = addDays(start, 6);
  const last = daysBetween(asOf, end) > 0 ? asOf : end;
  const dates = Array.from({ length: daysBetween(start, last) + 1 }, (_, i) => addDays(start, i));
  const pick = (m: ReadonlyMap<LocalDate, number>) => dates.flatMap((d) => (m.has(d) ? [m.get(d)!] : []));
  const acts = inputs.activities.filter((a) => daysBetween(start, a.date) >= 0 && daysBetween(a.date, last) >= 0);
  const sleep = pick(inputs.sleep);
  return {
    start,
    end,
    daysElapsed: dates.length,
    sessions: acts.length,
    trainingS: acts.reduce((s, a) => s + (a.durationS ?? 0), 0),
    load: pick(inputs.load).reduce((a, b) => a + b, 0),
    sleepAvgS: avg(sleep),
    sleepNights: sleep.length,
    hrvAvgMs: avg(pick(inputs.hrv)),
    rhrAvgBpm: avg(pick(inputs.rhr)),
    stepsAvg: avg(pick(inputs.steps)),
    intensityMin: dates.reduce((s, d) => {
      const i = inputs.intensity.get(d);
      return s + (i ? i.moderate + 2 * i.vigorous : 0);
    }, 0),
  };
}

/** WHO 2020: 150 minutes of moderate (or 75 vigorous) activity a week. Bull et al., BJSM 54:1451. */
export const WHO_WEEKLY_MIN = 150;

/**
 * Evidence for a weekly summary: this week against the previous one. Only
 * values that exist are included; the advice layer may cite nothing else.
 */
export function weeklyEvidence(week: WeekStats, prev: WeekStats | null, sleepNeedS: number): Evidence[] {
  const ev: Evidence[] = [];
  const window = week.daysElapsed === 7 ? "Mon–Sun" : `Mon–${week.daysElapsed} days so far`;
  ev.push({ id: "week_sessions", metric: "sessions", label: "Sessions", value: week.sessions, unit: "sessions", ...(prev ? { baseline: prev.sessions } : {}), window, source: "garmin" });
  if (week.trainingS > 0) {
    ev.push({ id: "week_training_time", metric: "training_time", label: "Training time", value: Math.round(week.trainingS), unit: "s", ...(prev ? { baseline: Math.round(prev.trainingS) } : {}), window, source: "garmin" });
  }
  ev.push({ id: "week_load", metric: "trimp", label: "Training load", value: Math.round(week.load), unit: "load", ...(prev ? { baseline: Math.round(prev.load) } : {}), window, source: "estimate" });
  if (week.sleepAvgS !== null) {
    ev.push({ id: "week_sleep_avg", metric: "sleep_total", label: "Average sleep", value: Math.round(week.sleepAvgS), unit: "s", baseline: sleepNeedS, window: `${week.sleepNights} nights`, source: "garmin" });
  }
  if (week.hrvAvgMs !== null) {
    ev.push({ id: "week_hrv_avg", metric: "hrv_rmssd_ms", label: "Average overnight HRV", value: r1(week.hrvAvgMs), unit: "ms", ...(prev?.hrvAvgMs != null ? { baseline: r1(prev.hrvAvgMs) } : {}), window, source: "garmin" });
  }
  if (week.rhrAvgBpm !== null) {
    ev.push({ id: "week_rhr_avg", metric: "resting_hr", label: "Average resting heart rate", value: r1(week.rhrAvgBpm), unit: "bpm", ...(prev?.rhrAvgBpm != null ? { baseline: r1(prev.rhrAvgBpm) } : {}), window, source: "garmin" });
  }
  if (week.stepsAvg !== null) {
    ev.push({ id: "week_steps_avg", metric: "steps", label: "Average daily steps", value: Math.round(week.stepsAvg), unit: "steps", ...(prev?.stepsAvg != null ? { baseline: Math.round(prev.stepsAvg) } : {}), window, source: "garmin" });
  }
  ev.push({ id: "week_intensity", metric: "intensity_minutes", label: "Intensity minutes", value: Math.round(week.intensityMin), unit: "min", baseline: WHO_WEEKLY_MIN, window, source: "garmin" });
  return ev;
}
