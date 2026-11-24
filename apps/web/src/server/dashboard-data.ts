import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { onePerDay } from "@/lib/weight";

type Series = Map<string, Map<string, number>>;

const DAILY: Record<string, (r: Record<string, number | null>) => number | null> = {
  steps: (r) => r.steps,
  distance_km: (r) => (r.distance_m == null ? null : r.distance_m / 1000),
  intensity_min: (r) => (r.intensity_min_moderate == null && r.intensity_min_vigorous == null ? null : (r.intensity_min_moderate ?? 0) + 2 * (r.intensity_min_vigorous ?? 0)),
  active_kcal: (r) => r.active_kcal,
  total_kcal: (r) => r.total_kcal,
  resting_hr: (r) => r.resting_hr,
  stress: (r) => r.stress_avg,
  body_battery: (r) => r.body_battery_high,
};
const SLEEP: Record<string, (r: Record<string, number | null>) => number | null> = {
  sleep_h: (r) => (r.total_sleep_s == null ? null : r.total_sleep_s / 3600),
  deep_h: (r) => (r.deep_s == null ? null : r.deep_s / 3600),
  rem_h: (r) => (r.rem_s == null ? null : r.rem_s / 3600),
  sleep_score: (r) => r.source_score,
};
const DERIVED: Record<string, { code: string; scale?: number }> = {
  readiness: { code: "readiness" },
  load: { code: "trimp_daily" },
  ctl: { code: "ctl" },
  atl: { code: "atl" },
  tsb: { code: "tsb" },
  sleep_debt_h: { code: "sleep_debt", scale: 1 / 3600 },
};
const ACTIVITY: Record<string, (a: { sport: string; duration_s: number | null; distance_m: number | null }) => number | null> = {
  training_min: (a) => (a.duration_s == null ? null : a.duration_s / 60),
  run_km: (a) => (/run/.test(a.sport) && a.distance_m != null ? a.distance_m / 1000 : null),
  ride_km: (a) => (/cycl|bik|ride/.test(a.sport) && a.distance_m != null ? a.distance_m / 1000 : null),
  strength_min: (a) => (/strength/.test(a.sport) && a.duration_s != null ? a.duration_s / 60 : null),
};
const FOOD: Record<string, "kcal" | "protein_g" | "carbs_g" | "fat_g"> = { eaten_kcal: "kcal", protein_g: "protein_g", carbs_g: "carbs_g", fat_g: "fat_g" };

/**
 * Daily values for each requested metric code in [from, to], through the
 * user's own session (RLS). Only the tables the codes need are queried.
 */
export async function loadMetricSeries(supabase: SupabaseClient, codes: ReadonlySet<string>, from: string, to: string): Promise<Series> {
  const out: Series = new Map([...codes].map((c) => [c, new Map<string, number>()]));
  const put = (code: string, date: string, v: number | null | undefined, add = false) => {
    if (v == null || !Number.isFinite(v)) return;
    const m = out.get(code)!;
    m.set(date, add ? (m.get(date) ?? 0) + v : v);
  };
  const want = (table: Record<string, unknown>) => [...codes].filter((c) => c in table);
  const jobs: Array<Promise<void>> = [];

  if (want(DAILY).length) {
    jobs.push(
      (async () => {
        const { data } = await supabase
          .from("daily_summaries")
          .select("local_date, steps, distance_m, intensity_min_moderate, intensity_min_vigorous, active_kcal, total_kcal, resting_hr, stress_avg, body_battery_high")
          .gte("local_date", from)
          .lte("local_date", to)
          .limit(1000);
        for (const r of data ?? []) for (const c of want(DAILY)) put(c, r.local_date as string, DAILY[c]!(r as Record<string, number | null>));
      })(),
    );
  }
  if (want(SLEEP).length) {
    jobs.push(
      (async () => {
        const { data } = await supabase
          .from("sleep_sessions")
          .select("local_date, total_sleep_s, deep_s, rem_s, source_score")
          .gte("local_date", from)
          .lte("local_date", to)
          .order("end_time")
          .limit(1000);
        // The last session of a date wins, as on Today.
        for (const r of data ?? []) for (const c of want(SLEEP)) put(c, r.local_date as string, SLEEP[c]!(r as Record<string, number | null>));
      })(),
    );
  }
  for (const c of want(DERIVED)) {
    const { code, scale } = DERIVED[c]!;
    jobs.push(
      (async () => {
        const { data } = await supabase.from("derived_daily").select("local_date, value").eq("metric_code", code).gte("local_date", from).lte("local_date", to).limit(1000);
        for (const r of data ?? []) put(c, r.local_date as string, r.value == null ? null : (r.value as number) * (scale ?? 1));
      })(),
    );
  }
  if (codes.has("hrv")) {
    jobs.push(
      (async () => {
        const { data } = await supabase.from("hrv_daily").select("local_date, last_night_avg_ms").gte("local_date", from).lte("local_date", to).limit(1000);
        for (const r of data ?? []) put("hrv", r.local_date as string, r.last_night_avg_ms as number | null);
      })(),
    );
  }
  if (codes.has("vo2max")) {
    jobs.push(
      (async () => {
        const { data } = await supabase.from("vo2max_daily").select("local_date, value").eq("sport", "running").gte("local_date", from).lte("local_date", to).limit(1000);
        for (const r of data ?? []) put("vo2max", r.local_date as string, r.value as number);
      })(),
    );
  }
  if (codes.has("weight") || codes.has("body_fat")) {
    jobs.push(
      (async () => {
        const { data } = await supabase.from("body_measurements").select("local_date, weight_kg, body_fat_pct, source").gte("local_date", from).lte("local_date", to).limit(1000);
        for (const r of onePerDay((data ?? []) as Array<{ local_date: string; weight_kg: number; body_fat_pct: number | null; source: string }>)) {
          if (codes.has("weight")) put("weight", r.local_date as string, r.weight_kg as number);
          if (codes.has("body_fat")) put("body_fat", r.local_date as string, r.body_fat_pct as number | null);
        }
      })(),
    );
  }
  if (want(ACTIVITY).length) {
    jobs.push(
      (async () => {
        const { data } = await supabase.from("activities").select("local_date, sport, duration_s, distance_m").gte("local_date", from).lte("local_date", to).limit(1000);
        for (const a of data ?? [])
          for (const c of want(ACTIVITY)) put(c, a.local_date as string, ACTIVITY[c]!(a as { sport: string; duration_s: number | null; distance_m: number | null }), true);
      })(),
    );
  }
  if (want(FOOD).length) {
    jobs.push(
      (async () => {
        const { data } = await supabase.from("food_log").select("local_date, kcal, protein_g, carbs_g, fat_g").gte("local_date", from).lte("local_date", to).limit(5000);
        for (const r of data ?? []) for (const c of want(FOOD)) put(c, r.local_date as string, r[FOOD[c]!] as number | null, true);
      })(),
    );
  }
  await Promise.all(jobs);
  return out;
}
