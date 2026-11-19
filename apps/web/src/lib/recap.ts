/** Year-in-review aggregation (pure). Inputs are one calendar year of rows. */
import { addDays, daysBetween } from "@ft/core";
import { weekStart } from "@ft/metrics";

export interface RecapInputs {
  year: number;
  activities: Array<{ id: string; date: string; sport: string; durationS: number | null; distanceM: number | null; ascentM: number | null; name: string | null }>;
  days: Array<{ date: string; steps: number | null; moderate: number | null; vigorous: number | null }>;
  sleep: Array<{ date: string; totalS: number }>;
  hrv: Array<{ date: string; ms: number }>;
  rhr: Array<{ date: string; bpm: number }>;
}

export interface SportTotal {
  sport: string;
  sessions: number;
  hours: number;
  km: number;
}

export interface Recap {
  sessions: number;
  hours: number;
  km: number;
  ascentM: number;
  activeDays: number;
  bySport: SportTotal[];
  /** Training hours per month, January first. */
  monthlyHours: number[];
  longestSession: RecapInputs["activities"][number] | null;
  furthestSession: RecapInputs["activities"][number] | null;
  biggestWeek: { monday: string; hours: number } | null;
  longestStreak: { days: number; from: string; to: string } | null;
  steps: { total: number; bestDay: { date: string; steps: number } | null; daysRecorded: number };
  /** Weeks with at least 150 WHO-weighted intensity minutes, out of weeks with data. */
  whoWeeks: { met: number; of: number };
  sleep: { avgS: number; nights: number } | null;
  /** First vs last quarter of the year's readings (needs 10 in each). */
  hrvChange: { from: number; to: number } | null;
  rhrChange: { from: number; to: number } | null;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

/** Mean of the earliest and latest quarters of a dated series, each with at least 10 values. */
function quarterChange(points: Array<{ date: string; v: number }>): { from: number; to: number } | null {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const q = Math.floor(sorted.length / 4);
  if (q < 10) return null;
  return { from: mean(sorted.slice(0, q).map((p) => p.v)), to: mean(sorted.slice(-q).map((p) => p.v)) };
}

export function recap(i: RecapInputs): Recap {
  const acts = i.activities.filter((a) => a.date.startsWith(`${i.year}-`));
  const hours = (s: number | null) => (s ?? 0) / 3600;

  const sports = new Map<string, SportTotal>();
  for (const a of acts) {
    const t = sports.get(a.sport) ?? { sport: a.sport, sessions: 0, hours: 0, km: 0 };
    t.sessions++;
    t.hours += hours(a.durationS);
    t.km += (a.distanceM ?? 0) / 1000;
    sports.set(a.sport, t);
  }

  const monthlyHours = Array.from({ length: 12 }, () => 0);
  for (const a of acts) monthlyHours[Number(a.date.slice(5, 7)) - 1]! += hours(a.durationS);

  const weekHours = new Map<string, number>();
  for (const a of acts) weekHours.set(weekStart(a.date), (weekHours.get(weekStart(a.date)) ?? 0) + hours(a.durationS));
  const biggest = [...weekHours].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];

  const activeDates = [...new Set(acts.map((a) => a.date))].sort();
  let best: Recap["longestStreak"] = null;
  let start = 0;
  for (let k = 1; k <= activeDates.length; k++) {
    if (k === activeDates.length || daysBetween(activeDates[k - 1]!, activeDates[k]!) !== 1) {
      const len = k - start;
      if (len >= 2 && (!best || len > best.days)) best = { days: len, from: activeDates[start]!, to: activeDates[k - 1]! };
      start = k;
    }
  }

  const stepDays = i.days.filter((d) => d.steps != null && d.steps > 0);
  const bestStep = stepDays.reduce<{ date: string; steps: number } | null>((b, d) => (!b || d.steps! > b.steps ? { date: d.date, steps: d.steps! } : b), null);

  const weekMinutes = new Map<string, number>();
  for (const d of i.days) {
    if (d.moderate == null && d.vigorous == null) continue;
    const w = weekStart(d.date);
    weekMinutes.set(w, (weekMinutes.get(w) ?? 0) + (d.moderate ?? 0) + 2 * (d.vigorous ?? 0));
  }

  const longestSession = acts.reduce<Recap["longestSession"]>((b, a) => ((a.durationS ?? 0) > (b?.durationS ?? 0) ? a : b), null);
  const furthestSession = acts.reduce<Recap["furthestSession"]>((b, a) => ((a.distanceM ?? 0) > (b?.distanceM ?? 0) ? a : b), null);

  return {
    sessions: acts.length,
    hours: sum(acts.map((a) => hours(a.durationS))),
    km: sum(acts.map((a) => (a.distanceM ?? 0) / 1000)),
    ascentM: sum(acts.map((a) => a.ascentM ?? 0)),
    activeDays: activeDates.length,
    bySport: [...sports.values()].sort((a, b) => b.hours - a.hours),
    monthlyHours,
    longestSession: longestSession && (longestSession.durationS ?? 0) > 0 ? longestSession : null,
    furthestSession: furthestSession && (furthestSession.distanceM ?? 0) >= 100 ? furthestSession : null,
    biggestWeek: biggest ? { monday: biggest[0], hours: biggest[1] } : null,
    longestStreak: best,
    steps: { total: sum(stepDays.map((d) => d.steps!)), bestDay: bestStep, daysRecorded: stepDays.length },
    whoWeeks: { met: [...weekMinutes.values()].filter((m) => m >= 150).length, of: weekMinutes.size },
    sleep: i.sleep.length ? { avgS: mean(i.sleep.map((s) => s.totalS)), nights: i.sleep.length } : null,
    hrvChange: quarterChange(i.hrv.map((p) => ({ date: p.date, v: p.ms }))),
    rhrChange: quarterChange(i.rhr.map((p) => ({ date: p.date, v: p.bpm }))),
  };
}

/** The first day of each month of a year, for chart labels. */
export function monthStarts(year: number): string[] {
  return Array.from({ length: 12 }, (_, m) => `${year}-${String(m + 1).padStart(2, "0")}-01`);
}

/** Days of the year covered so far (to `today`), for "so far" wording. */
export function daysCovered(year: number, today: string): number {
  const first = `${year}-01-01`;
  const last = today.startsWith(`${year}-`) ? today : `${year}-12-31`;
  return today < first ? 0 : daysBetween(first, last) + 1;
}

export const firstOfYear = (year: number) => `${year}-01-01`;
export const lastOfYear = (year: number) => addDays(`${year + 1}-01-01`, -1);
