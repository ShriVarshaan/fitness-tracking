import "server-only";
import { addDays } from "@ft/core";
import {
  bestAcross,
  bestEffortTimes,
  criticalFit,
  CRITICAL_DURATIONS_S,
  meanMaximal,
  predictRace,
  RACE_DISTANCES,
  type BestPoint,
  type CriticalFit,
  type MetricResult,
  type RacePrediction,
} from "@ft/metrics";
import type { createClient } from "@/lib/supabase/server";
import { isCycling } from "@/lib/activity";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Best efforts and the fits use this many days, ending at the latest activity of that kind. */
export const PERFORMANCE_WINDOW_DAYS = 90;

export const isRun = (sport: string) => /running/.test(sport);

export interface RunningPerformance {
  from: string;
  to: string;
  activities: number;
  bests: BestPoint[];
  criticalSpeed: MetricResult<CriticalFit>;
  predictions: Array<{ key: string; label: string; m: number; result: MetricResult<RacePrediction> }>;
}

export interface CyclingPerformance {
  from: string;
  to: string;
  activities: number;
  bests: BestPoint[];
  criticalPower: MetricResult<CriticalFit>;
}

interface ActivityRef {
  source_record_id: string;
  local_date: string;
  sport: string;
}

/** Streams for the given activities, keyed by activity id then stream name. RLS limits rows to the user. */
async function loadStreams(supabase: Supabase, ids: string[], streams: string[]): Promise<Map<string, Map<string, Array<number | null>>>> {
  const out = new Map<string, Map<string, Array<number | null>>>();
  // Batches keep each request URL and response modest.
  for (let i = 0; i < ids.length; i += 20) {
    const { data } = await supabase
      .from("activity_streams")
      .select("source_record_id, stream, values")
      .in("source_record_id", ids.slice(i, i + 20))
      .in("stream", streams);
    for (const row of (data ?? []) as Array<{ source_record_id: string; stream: string; values: Array<number | null> }>) {
      const m = out.get(row.source_record_id) ?? new Map();
      m.set(row.stream, row.values);
      out.set(row.source_record_id, m);
    }
  }
  return out;
}

async function recent(supabase: Supabase, match: (sport: string) => boolean): Promise<{ from: string; to: string; list: ActivityRef[] } | null> {
  const { data } = await supabase
    .from("activities")
    .select("source_record_id, local_date, sport")
    .order("start_time", { ascending: false })
    .limit(1000);
  const all = ((data ?? []) as ActivityRef[]).filter((a) => match(a.sport));
  const to = all[0]?.local_date;
  if (!to) return null;
  const from = addDays(to, -(PERFORMANCE_WINDOW_DAYS - 1));
  return { from, to, list: all.filter((a) => a.local_date >= from) };
}

export async function runningPerformance(supabase: Supabase): Promise<RunningPerformance | null> {
  const runs = await recent(supabase, isRun);
  if (!runs) return null;
  const streams = await loadStreams(supabase, runs.list.map((a) => a.source_record_id), ["time_s", "distance"]);
  const targets = RACE_DISTANCES.map((r) => r.m);
  const per: Array<{ id: string; date: string; times: Map<number, number>; speeds: Map<number, number> }> = [];
  for (const a of runs.list) {
    const s = streams.get(a.source_record_id);
    const t = s?.get("time_s");
    const d = s?.get("distance");
    if (!t || !d) continue;
    const time = t.map((v) => v ?? 0);
    // Mean-maximal speed = best distance gained per window ÷ window, from distance increments.
    const speedPerSample = d.map((v, i) => {
      const prev = i > 0 ? d[i - 1] : null;
      const dt = i > 0 ? time[i]! - time[i - 1]! : 0;
      return typeof v === "number" && typeof prev === "number" && dt > 0 ? Math.max(0, v - prev) / dt : null;
    });
    // meanMaximal carries sample i − 1's value over [t(i−1), t(i)], so shift the increments back one.
    const speeds = meanMaximal(time, [...speedPerSample.slice(1), null], CRITICAL_DURATIONS_S);
    per.push({ id: a.source_record_id, date: a.local_date, times: bestEffortTimes(time, d, targets), speeds });
  }
  // Runs without an activity file (e.g. imported from Apple Health) have no streams: nothing to show.
  if (!per.length) return null;
  const bests = bestAcross(per.map((p) => ({ id: p.id, date: p.date, values: p.times })), "min");
  const speedBests = bestAcross(per.map((p) => ({ id: p.id, date: p.date, values: p.speeds })), "max");
  return {
    from: runs.from,
    to: runs.to,
    activities: per.length,
    bests,
    criticalSpeed: criticalFit(speedBests.map((b) => ({ durationS: b.key, average: b.value }))),
    predictions: RACE_DISTANCES.filter((r) => r.m >= 5000).map((r) => ({ ...r, result: predictRace(r.m, bests) })),
  };
}

export async function cyclingPerformance(supabase: Supabase): Promise<CyclingPerformance | null> {
  const rides = await recent(supabase, isCycling);
  if (!rides) return null;
  const streams = await loadStreams(supabase, rides.list.map((a) => a.source_record_id), ["time_s", "power"]);
  const per: Array<{ id: string; date: string; values: Map<number, number> }> = [];
  for (const a of rides.list) {
    const s = streams.get(a.source_record_id);
    const t = s?.get("time_s");
    const p = s?.get("power");
    if (!t || !p || !p.some((v) => typeof v === "number" && v > 0)) continue;
    per.push({ id: a.source_record_id, date: a.local_date, values: meanMaximal(t.map((v) => v ?? 0), p, CRITICAL_DURATIONS_S) });
  }
  if (!per.length) return null;
  const bests = bestAcross(per, "max");
  return {
    from: rides.from,
    to: rides.to,
    activities: per.length,
    bests,
    criticalPower: criticalFit(bests.map((b) => ({ durationS: b.key, average: b.value }))),
  };
}
