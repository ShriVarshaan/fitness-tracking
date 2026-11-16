import "server-only";
import { addDays } from "@ft/core";
import { createClient } from "@/lib/supabase/server";

const WINDOW_DAYS = 30;

export interface DaySummary {
  local_date: string;
  steps: number | null;
  steps_goal: number | null;
  distance_m: number | null;
  resting_hr: number | null;
  stress_avg: number | null;
  body_battery_high: number | null;
  body_battery_low: number | null;
  intensity_min_moderate: number | null;
  intensity_min_vigorous: number | null;
  intensity_min_goal: number | null;
}

export interface HrvDay {
  local_date: string;
  last_night_avg_ms: number | null;
  weekly_avg_ms: number | null;
  baseline_balanced_low_ms: number | null;
  baseline_balanced_upper_ms: number | null;
  source_status: string | null;
}

export interface SleepNight {
  local_date: string;
  start_time: string;
  end_time: string;
  total_sleep_s: number | null;
  deep_s: number | null;
  light_s: number | null;
  rem_s: number | null;
  awake_s: number | null;
  source_score: number | null;
  source_score_qualifier: string | null;
  sleep_need_min: number | null;
}

export interface DerivedValue {
  value: number | null;
  confidence: number;
  components: Record<string, unknown>;
}

export interface TodayData {
  /** Most recent day with data; null if nothing has synced yet. */
  latestDate: string | null;
  dates: string[];
  days: Map<string, DaySummary>;
  hrv: Map<string, HrvDay>;
  sleep: Map<string, SleepNight>;
  /** Our estimates: metric code → date → value. */
  derived: Map<string, Map<string, DerivedValue>>;
  connection: { status: string; key_expires_on: string | null; backfill_complete: boolean } | null;
}

/** Last 30 days for the signed-in user. Reads go through RLS (own rows only). */
export async function loadToday(): Promise<TodayData> {
  const supabase = await createClient();

  const [{ data: latest }, { data: connection }] = await Promise.all([
    supabase.from("daily_summaries").select("local_date").order("local_date", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("garmin_connection").select("status, key_expires_on, backfill_complete").maybeSingle(),
  ]);

  const latestDate = (latest?.local_date as string | undefined) ?? null;
  if (!latestDate) {
    return {
      latestDate: null,
      dates: [],
      days: new Map(),
      hrv: new Map(),
      sleep: new Map(),
      derived: new Map(),
      connection: connection ?? null,
    };
  }

  const from = addDays(latestDate, -(WINDOW_DAYS - 1));
  const [{ data: days }, { data: hrv }, { data: sleep }, { data: derived }] = await Promise.all([
    supabase
      .from("daily_summaries")
      .select(
        "local_date, steps, steps_goal, distance_m, resting_hr, stress_avg, body_battery_high, body_battery_low, intensity_min_moderate, intensity_min_vigorous, intensity_min_goal",
      )
      .gte("local_date", from)
      .lte("local_date", latestDate),
    supabase
      .from("hrv_daily")
      .select("local_date, last_night_avg_ms, weekly_avg_ms, baseline_balanced_low_ms, baseline_balanced_upper_ms, source_status")
      .gte("local_date", from)
      .lte("local_date", latestDate),
    supabase
      .from("sleep_sessions")
      .select(
        "local_date, start_time, end_time, total_sleep_s, deep_s, light_s, rem_s, awake_s, source_score, source_score_qualifier, sleep_need_min",
      )
      .gte("local_date", from)
      .lte("local_date", latestDate)
      .order("end_time", { ascending: true }),
    supabase
      .from("derived_daily")
      .select("local_date, metric_code, value, confidence, components")
      .in("metric_code", ["readiness", "ctl", "atl", "tsb", "acwr", "sleep_debt", "trimp_daily"])
      .gte("local_date", from)
      .lte("local_date", latestDate),
  ]);

  const derivedByMetric = new Map<string, Map<string, DerivedValue>>();
  for (const r of (derived ?? []) as Array<DerivedValue & { local_date: string; metric_code: string }>) {
    if (!derivedByMetric.has(r.metric_code)) derivedByMetric.set(r.metric_code, new Map());
    derivedByMetric.get(r.metric_code)!.set(r.local_date, { value: r.value, confidence: r.confidence, components: r.components });
  }

  const dates = Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(from, i));
  return {
    latestDate,
    dates,
    days: new Map((days as DaySummary[] | null)?.map((d) => [d.local_date, d]) ?? []),
    hrv: new Map((hrv as HrvDay[] | null)?.map((h) => [h.local_date, h]) ?? []),
    // If a date has two sessions, the later one (ordered by end time) wins.
    sleep: new Map((sleep as SleepNight[] | null)?.map((s) => [s.local_date, s]) ?? []),
    derived: derivedByMetric,
    connection: connection ?? null,
  };
}
