import { daysBetween, type LocalDate } from "@ft/core";
import { r1, type Evidence } from "./rules/types";

/** One recorded session, as the post-workout summary sees it. */
export interface SessionInput {
  id: string;
  /** Garmin sport key, e.g. "running"; sessions are only compared with the same sport. */
  sport: string;
  date: LocalDate;
  /** Start instant (ISO), used to order sessions on the same day. */
  startTime: string;
  durationS: number | null;
  distanceM: number | null;
  avgHr: number | null;
  /** Our Edwards TRIMP for this session (null without HR data). */
  load: number | null;
  /** Garmin's aerobic training effect (0–5), shown as Garmin's. */
  aerobicTe: number | null;
  /** Session effort 1–10, when rated on the watch. */
  rpe: number | null;
}

/** Sessions of the same sport in the 28 days before this one form "your typical session". */
export const TYPICAL_WINDOW_DAYS = 28;
/** Fewer earlier sessions with a load than this and there is no comparison. */
export const TYPICAL_MIN_SESSIONS = 3;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** "tennis_v2" → "tennis", "strength_training" → "strength training". */
export const sportLabel = (sport: string) => sport.replace(/_v\d+$/, "").replace(/_/g, " ").toLowerCase();

/**
 * Typical session load: the median Edwards TRIMP of sessions of the same sport
 * in the 28 days before this one (excluding it). A gym session and a long run
 * load the body differently, so mixing sports would make the comparison meaningless. Median, not mean, so one race or one short
 * walk doesn't move it much. Null with fewer than 3 earlier sessions.
 */
export function typicalSessionLoad(session: SessionInput, all: readonly SessionInput[]): { value: number; sessions: number } | null {
  const earlier = all.filter((s) => {
    if (s.id === session.id || s.load === null || s.sport !== session.sport) return false;
    const ago = daysBetween(s.date, session.date);
    if (ago < 0 || ago > TYPICAL_WINDOW_DAYS) return false;
    return ago > 0 || s.startTime < session.startTime;
  });
  if (earlier.length < TYPICAL_MIN_SESSIONS) return null;
  return { value: median(earlier.map((s) => s.load!)), sessions: earlier.length };
}

/** The most recent session (by start time), or null. */
export function latestSession<T extends SessionInput>(all: readonly T[]): T | null {
  return all.reduce<T | null>((best, s) => (best === null || s.startTime > best.startTime ? s : best), null);
}

/**
 * Evidence for a post-workout summary. Only values that exist are included;
 * the advice layer may cite nothing else.
 */
export function sessionEvidence(session: SessionInput, all: readonly SessionInput[]): Evidence[] {
  const ev: Evidence[] = [];
  const window = "this session";
  if (session.durationS !== null && session.durationS > 0) {
    ev.push({ id: "session_duration", metric: "duration", label: "Duration", value: session.durationS, unit: "s", window, source: "garmin" });
  }
  if (session.distanceM !== null && session.distanceM >= 100) {
    ev.push({ id: "session_distance", metric: "distance", label: "Distance", value: r1(session.distanceM / 1000), unit: "km", window, source: "garmin" });
  }
  if (session.avgHr !== null) {
    ev.push({ id: "session_avg_hr", metric: "avg_hr", label: "Average heart rate", value: session.avgHr, unit: "bpm", window, source: "garmin" });
  }
  if (session.load !== null) {
    const typical = typicalSessionLoad(session, all);
    ev.push({
      id: "session_load",
      metric: "trimp",
      label: "Training load",
      value: Math.round(session.load),
      unit: "load",
      ...(typical ? { baseline: Math.round(typical.value) } : {}),
      window: typical
        ? `this session vs median of ${typical.sessions} ${sportLabel(session.sport)} sessions in the previous ${TYPICAL_WINDOW_DAYS} days`
        : window,
      source: "estimate",
    });
  }
  if (session.aerobicTe !== null) {
    ev.push({ id: "session_aerobic_te", metric: "aerobic_te", label: "Aerobic training effect", value: r1(session.aerobicTe), unit: "te", window, source: "garmin" });
  }
  if (session.rpe !== null) {
    ev.push({ id: "session_rpe", metric: "rpe", label: "Your effort rating", value: Math.round(session.rpe), unit: "/10", window, source: "garmin" });
  }
  return ev;
}
