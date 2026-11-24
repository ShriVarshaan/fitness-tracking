import "server-only";
import { tool } from "ai";
import { z } from "zod";
import { formatDuration } from "@/lib/format";
import { onePerDay } from "@/lib/weight";
import type { createClient } from "@/lib/supabase/server";

/**
 * Read-only, typed tools for chat (docs/PLAN.md §7). They query through the
 * signed-in user's own Supabase session, so RLS limits every read to their
 * rows; no tool accepts a user id. No free-form SQL. Results are capped.
 */

type Supa = Awaited<ReturnType<typeof createClient>>;

const MAX_POINTS = 120;
const MAX_RANGE_DAYS = 366;
const isoDate = z.iso.date().describe("YYYY-MM-DD");

/** Where each metric lives and how to show it. */
const METRICS = {
  resting_hr: { table: "daily_summaries", column: "resting_hr", unit: "bpm", label: "Resting heart rate (from the user's watch: Garmin or Apple Health)" },
  hrv: { table: "hrv_daily", column: "last_night_avg_ms", unit: "ms", label: "Overnight HRV, RMSSD (Garmin)" },
  sleep_duration: { table: "sleep_sessions", column: "total_sleep_s", unit: "s", label: "Sleep duration (from the user's watch: Garmin or Apple Health)" },
  steps: { table: "daily_summaries", column: "steps", unit: "steps", label: "Steps (Garmin or Apple Health)" },
  stress: { table: "daily_summaries", column: "stress_avg", unit: "score", label: "Average stress (Garmin, 0-100)" },
  body_battery_high: { table: "daily_summaries", column: "body_battery_high", unit: "score", label: "Body Battery high (Garmin)" },
  readiness: { derived: "readiness", unit: "score", label: "Readiness (our estimate, 0-100)" },
  training_load: { derived: "trimp_daily", unit: "load", label: "Daily training load (our estimate, Edwards TRIMP)" },
  fitness: { derived: "ctl", unit: "load", label: "Fitness, chronic load (our estimate)" },
  fatigue: { derived: "atl", unit: "load", label: "Fatigue, acute load (our estimate)" },
  form: { derived: "tsb", unit: "load", label: "Form = fitness - fatigue (our estimate)" },
  sleep_debt: { derived: "sleep_debt", unit: "s", label: "7-night sleep debt (our estimate)" },
  sleep_regularity: { derived: "sri", unit: "score", label: "Sleep Regularity Index over 14 days (our estimate, -100 to 100; 100 = identical timing)" },
  weight: { table: "body_measurements", column: "weight_kg", unit: "kg", label: "Weight (entered by the user, or from a Garmin scale or Apple Health)" },
  energy_eaten: { table: "food_log", column: "kcal", unit: "kcal", label: "Energy eaten, daily total from the food diary", sum: true },
  protein_eaten: { table: "food_log", column: "protein_g", unit: "g", label: "Protein eaten, daily total from the food diary", sum: true },
} as const;
type MetricKey = keyof typeof METRICS;
const metricEnum = z.enum(Object.keys(METRICS) as [MetricKey, ...MetricKey[]]);

const round = (v: number, dp = 1) => Math.round(v * 10 ** dp) / 10 ** dp;
const show = (v: number, unit: string) => (unit === "s" ? formatDuration(v) : `${round(v)} ${unit}`);

function checkRange(from: string, to: string): string | null {
  const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (days < 0) return "from must be on or before to";
  if (days > MAX_RANGE_DAYS) return `range too long (max ${MAX_RANGE_DAYS} days)`;
  return null;
}

async function series(supa: Supa, metric: MetricKey, from: string, to: string): Promise<Array<{ date: string; value: number }>> {
  const m = METRICS[metric];
  if ("derived" in m) {
    const { data } = await supa
      .from("derived_daily")
      .select("local_date, value")
      .eq("metric_code", m.derived)
      .gte("local_date", from)
      .lte("local_date", to)
      .order("local_date");
    return (data ?? []).filter((r) => r.value != null).map((r) => ({ date: r.local_date as string, value: r.value as number }));
  }
  const { data: raw } = await supa.from(m.table).select(m.table === "body_measurements" ? `local_date, source, ${m.column}` : `local_date, ${m.column}`).gte("local_date", from).lte("local_date", to).order("local_date");
  // Weight: one per day, the user's own entry over a Garmin scale reading.
  const data = m.table === "body_measurements" ? onePerDay((raw ?? []) as unknown as Array<{ local_date: string; source: string }>) : raw;
  // Diary entries add up per day; several sleep sessions on one date: keep the longest.
  const sum = "sum" in m && m.sum;
  const byDate = new Map<string, number>();
  for (const r of (data ?? []) as unknown as Array<Record<string, unknown>>) {
    const v = r[m.column];
    if (typeof v !== "number") continue;
    const d = r.local_date as string;
    byDate.set(d, sum ? (byDate.get(d) ?? 0) + v : Math.max(byDate.get(d) ?? -Infinity, v));
  }
  return [...byDate.entries()].map(([date, value]) => ({ date, value }));
}

function summarise(points: Array<{ date: string; value: number }>, unit: string) {
  if (points.length === 0) return { days_with_data: 0, note: "No data in this range." };
  const values = points.map((p) => p.value);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const min = points.reduce((a, b) => (b.value < a.value ? b : a));
  const max = points.reduce((a, b) => (b.value > a.value ? b : a));
  return {
    days_with_data: points.length,
    first: { date: points[0]!.date, value: round(points[0]!.value), display: show(points[0]!.value, unit) },
    last: { date: points.at(-1)!.date, value: round(points.at(-1)!.value), display: show(points.at(-1)!.value, unit) },
    mean: round(mean),
    mean_display: show(mean, unit),
    min: { date: min.date, value: round(min.value), display: show(min.value, unit) },
    max: { date: max.date, value: round(max.value), display: show(max.value, unit) },
    ...(unit === "s" ? { mean_hours: round(mean / 3600, 2) } : {}),
  };
}

export function chatTools(supa: Supa) {
  return {
    get_data_availability: tool({
      description: "Which kinds of data the user has, and the date range of each. Call this first if unsure what exists.",
      inputSchema: z.object({}),
      execute: async () => {
        const out: Record<string, unknown> = {};
        for (const table of ["daily_summaries", "sleep_sessions", "hrv_daily", "activities", "body_measurements", "food_log", "planned_workouts"] as const) {
          const [{ data: first }, { data: last }, { count }] = await Promise.all([
            supa.from(table).select("local_date").order("local_date").limit(1).maybeSingle(),
            supa.from(table).select("local_date").order("local_date", { ascending: false }).limit(1).maybeSingle(),
            supa.from(table).select("*", { count: "exact", head: true }),
          ]);
          out[table] = { first: first?.local_date ?? null, last: last?.local_date ?? null, rows: count ?? 0 };
        }
        return out;
      },
    }),

    summarize_metric: tool({
      description:
        "Mean, min, max, first and last of one metric over a date range. Use these numbers (or their display strings) when answering; don't compute your own averages.",
      inputSchema: z.object({ metric: metricEnum, from: isoDate, to: isoDate }),
      execute: async ({ metric, from, to }) => {
        const bad = checkRange(from, to);
        if (bad) return { error: bad };
        const m = METRICS[metric];
        return { metric, label: m.label, unit: m.unit, from, to, ...summarise(await series(supa, metric, from, to), m.unit) };
      },
    }),

    compare_periods: tool({
      description: "Compare one metric between two date ranges (e.g. this month vs last month). Returns both summaries and the difference of means.",
      inputSchema: z.object({
        metric: metricEnum,
        a_from: isoDate,
        a_to: isoDate,
        b_from: isoDate,
        b_to: isoDate,
      }),
      execute: async ({ metric, a_from, a_to, b_from, b_to }) => {
        const bad = checkRange(a_from, a_to) ?? checkRange(b_from, b_to);
        if (bad) return { error: bad };
        const m = METRICS[metric];
        const a = summarise(await series(supa, metric, a_from, a_to), m.unit);
        const b = summarise(await series(supa, metric, b_from, b_to), m.unit);
        const diff = "mean" in a && "mean" in b ? round(b.mean - a.mean) : null;
        return {
          metric,
          label: m.label,
          unit: m.unit,
          period_a: { from: a_from, to: a_to, ...a },
          period_b: { from: b_from, to: b_to, ...b },
          change_b_minus_a: diff,
          ...(diff !== null && m.unit === "s" ? { change_display: `${diff < 0 ? "-" : "+"}${formatDuration(Math.abs(diff))}` } : {}),
          ...(diff !== null && "mean" in a && a.mean ? { change_percent: round((diff / a.mean) * 100) } : {}),
        };
      },
    }),

    get_daily_values: tool({
      description: `Day-by-day values of one metric (at most ${MAX_POINTS} days; longer ranges are rejected). Prefer summarize_metric for averages.`,
      inputSchema: z.object({ metric: metricEnum, from: isoDate, to: isoDate }),
      execute: async ({ metric, from, to }) => {
        const bad = checkRange(from, to);
        if (bad) return { error: bad };
        const points = await series(supa, metric, from, to);
        if (points.length > MAX_POINTS) return { error: `too many days (${points.length}); narrow the range or use summarize_metric` };
        const m = METRICS[metric];
        return { metric, label: m.label, unit: m.unit, values: points.map((p) => ({ date: p.date, value: round(p.value), display: show(p.value, m.unit) })) };
      },
    }),

    list_activities: tool({
      description: "List recorded activities (newest first), optionally filtered by date range and sport (e.g. running, strength_training).",
      inputSchema: z.object({
        from: isoDate.optional(),
        to: isoDate.optional(),
        sport: z.string().max(40).optional(),
        limit: z.number().int().min(1).max(50).default(20),
      }),
      execute: async ({ from, to, sport, limit }) => {
        let q = supa
          .from("activities")
          .select("source_record_id, local_date, sport, name, duration_s, distance_m, avg_hr, source_training_load, rpe")
          .order("start_time", { ascending: false })
          .limit(limit);
        if (from) q = q.gte("local_date", from);
        if (to) q = q.lte("local_date", to);
        if (sport) q = q.eq("sport", sport);
        const { data } = await q;
        return (data ?? []).map((a) => ({
          id: a.source_record_id,
          date: a.local_date,
          sport: a.sport,
          name: a.name,
          duration: a.duration_s ? formatDuration(a.duration_s) : null,
          distance_km: a.distance_m ? round(a.distance_m / 1000, 2) : null,
          avg_hr_bpm: a.avg_hr,
          garmin_training_load: a.source_training_load ? round(a.source_training_load) : null,
          rpe: a.rpe,
        }));
      },
    }),

    list_planned_workouts: tool({
      description: "Workouts the user planned in the app's training calendar, in a date range (at most 60 days), with intensity and target time.",
      inputSchema: z.object({ from: isoDate, to: isoDate }),
      execute: async ({ from, to }) => {
        const bad = checkRange(from, to);
        if (bad) return { error: bad };
        if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 60) return { error: "range too long (max 60 days)" };
        const { data } = await supa
          .from("planned_workouts")
          .select("local_date, sport, title, intensity, target_duration_s")
          .gte("local_date", from)
          .lte("local_date", to)
          .order("local_date")
          .limit(60);
        return (data ?? []).map((w) => ({
          date: w.local_date,
          sport: w.sport,
          title: w.title,
          intensity: w.intensity,
          target: w.target_duration_s ? formatDuration(w.target_duration_s) : null,
        }));
      },
    }),

    get_findings: tool({
      description: "What the rules found on a given day (e.g. HRV below normal, short sleep), with the numbers behind each finding.",
      inputSchema: z.object({ date: isoDate }),
      execute: async ({ date }) => {
        const { data } = await supa.from("findings").select("rule_id, severity, evidence").eq("local_date", date);
        return { date, findings: data ?? [] };
      },
    }),
  };
}

export type ChatTools = ReturnType<typeof chatTools>;
