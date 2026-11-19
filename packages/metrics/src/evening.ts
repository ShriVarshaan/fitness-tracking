import type { LocalDate } from "@ft/core";
import type { Evidence } from "./rules/types";
import { WHO_WEEKLY_MIN } from "./weekly";

/** What the evening check-in looks at, for one local date. */
export interface EveningInputs {
  date: LocalDate;
  steps: number | null;
  stepsGoal: number | null;
  /** WHO-weighted intensity minutes (moderate + 2 × vigorous) from Monday to today. */
  intensityWeekSoFar: number | null;
  /** Sessions recorded today and their summed training load (our estimate; null without HR). */
  sessionsToday: number;
  loadToday: number | null;
  /** Current 7-night sleep debt (our estimate), seconds; null when not available. */
  sleepDebtS: number | null;
  sleepNeedS: number;
  /** Local wake times of recent nights, minutes after midnight (e.g. 420 = 07:00). */
  recentWakeMin: number[];
}

/** Nights of wake times needed before suggesting a bedtime. */
export const WAKE_MIN_NIGHTS = 5;
/** Sleep debt above this (seconds) earns an earlier bedtime: half the debt, capped at 30 min. */
const DEBT_NUDGE_S = 3600;
const MAX_EARLIER_S = 1800;

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Suggested time to be asleep: usual wake time (median of recent nights) minus
 * sleep need, and up to 30 min earlier when the 7-night sleep debt is over an
 * hour (half the debt). Heuristic, unvalidated: it applies the sleep-need
 * figure (Hirshkowitz et al. 2015) to the person's own wake time; a consistent
 * wake time is the usual sleep-hygiene advice. Rounded to 5 minutes.
 * Null with fewer than 5 recent wake times.
 */
export function suggestedBedtime(recentWakeMin: readonly number[], sleepNeedS: number, sleepDebtS: number | null): { wakeMin: number; bedMin: number; earlierS: number } | null {
  if (recentWakeMin.length < WAKE_MIN_NIGHTS || !(sleepNeedS > 0)) return null;
  const wake = Math.round(median(recentWakeMin) / 5) * 5;
  const earlierS = sleepDebtS !== null && sleepDebtS > DEBT_NUDGE_S ? Math.min(MAX_EARLIER_S, Math.round(sleepDebtS / 2 / 300) * 300) : 0;
  const bed = Math.round((wake - (sleepNeedS + earlierS) / 60) / 5) * 5;
  return { wakeMin: ((wake % 1440) + 1440) % 1440, bedMin: ((bed % 1440) + 1440) % 1440, earlierS };
}

/** Evidence for the evening check-in. Only values that exist are included. */
export function eveningEvidence(i: EveningInputs): Evidence[] {
  const ev: Evidence[] = [];
  if (i.steps !== null) {
    ev.push({ id: "evening_steps", metric: "steps", label: "Steps today", value: i.steps, unit: "steps", ...(i.stepsGoal ? { baseline: i.stepsGoal, baselineLabel: "goal" } : {}), window: "today", source: "garmin" });
  }
  if (i.intensityWeekSoFar !== null) {
    ev.push({
      id: "evening_week_intensity",
      metric: "intensity_minutes",
      label: "Intensity minutes this week",
      value: i.intensityWeekSoFar,
      unit: "min",
      baseline: WHO_WEEKLY_MIN,
      baselineLabel: "WHO target",
      window: "Monday to today, vigorous counted double",
      source: "garmin",
    });
  }
  if (i.sessionsToday > 0) {
    ev.push({ id: "evening_sessions", metric: "sessions", label: "Sessions today", value: i.sessionsToday, unit: "sessions", window: "today", source: "garmin" });
    if (i.loadToday !== null && i.loadToday > 0) {
      ev.push({ id: "evening_load", metric: "trimp", label: "Training load today", value: Math.round(i.loadToday), unit: "load", window: "today", source: "estimate" });
    }
  }
  if (i.sleepDebtS !== null) {
    ev.push({ id: "evening_sleep_debt", metric: "sleep_debt", label: "Sleep debt", value: i.sleepDebtS, unit: "s", window: "last 7 nights", source: "estimate" });
  }
  const bed = suggestedBedtime(i.recentWakeMin, i.sleepNeedS, i.sleepDebtS);
  if (bed) {
    ev.push({ id: "evening_sleep_need", metric: "sleep_need", label: "Sleep need", value: i.sleepNeedS, unit: "s", window: "your setting", source: "estimate" });
    ev.push({ id: "evening_usual_wake", metric: "wake_time", label: "Usual wake time", value: bed.wakeMin, unit: "clock", window: `median of the last ${i.recentWakeMin.length} nights`, source: "garmin" });
    ev.push({ id: "evening_bedtime", metric: "bedtime", label: "Suggested sleep time", value: bed.bedMin, unit: "clock", window: "usual wake time minus sleep need", source: "estimate" });
    if (bed.earlierS > 0) {
      ev.push({ id: "evening_earlier", metric: "earlier", label: "Earlier for sleep debt", value: bed.earlierS, unit: "s", window: "half the sleep debt, up to 30 min", source: "estimate" });
    }
  }
  return ev;
}
