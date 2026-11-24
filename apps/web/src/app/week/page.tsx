import type { Metadata } from "next";
import type { Insight } from "@ft/advice";
import { addDays } from "@ft/core";
import { weekStart } from "@ft/metrics";
import { AppNav } from "@/components/app-nav";
import { InsightCard } from "@/components/insight-card";
import { formatDuration, formatNumber } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Week" };

const WEEKS = 8;

interface WeekRow {
  monday: string;
  sessions: number;
  trainingS: number;
  load: number;
  sleepTotal: number;
  sleepNights: number;
  hrvTotal: number;
  hrvNights: number;
}

function weekLabel(monday: string): string {
  const d = new Date(`${monday}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export default async function WeekPage() {
  // Every read goes through the user's session, so RLS limits it to their own rows.
  const supabase = await createClient();
  const { data: latest } = await supabase
    .from("daily_summaries")
    .select("local_date")
    .order("local_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  const latestDate = latest?.local_date as string | undefined;

  if (!latestDate) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-8 sm:py-10">
        <header className="space-y-3">
          <AppNav current="/week" />
          <h1 className="text-2xl font-semibold tracking-tight">Week</h1>
        </header>
        <p className="rounded-lg border border-border bg-surface p-5 text-sm text-muted">
          No data yet. Connect Garmin or load demo data from the Today page.
        </p>
      </main>
    );
  }

  const thisMonday = weekStart(latestDate);
  const from = addDays(thisMonday, -7 * (WEEKS - 1));
  const [{ data: weekly }, { data: acts }, { data: sleep }, { data: hrv }, { data: load }] = await Promise.all([
    supabase.from("insights").select("for_date, body, validator_ok").eq("kind", "weekly").order("for_date", { ascending: false }).limit(2),
    supabase.from("activities").select("local_date, duration_s").gte("local_date", from),
    supabase.from("sleep_sessions").select("local_date, total_sleep_s").gte("local_date", from),
    supabase.from("hrv_daily").select("local_date, last_night_avg_ms").gte("local_date", from),
    supabase.from("derived_daily").select("local_date, value").eq("metric_code", "trimp_daily").gte("local_date", from),
  ]);

  const rows = new Map<string, WeekRow>();
  for (let i = 0; i < WEEKS; i++) {
    const monday = addDays(from, i * 7);
    rows.set(monday, { monday, sessions: 0, trainingS: 0, load: 0, sleepTotal: 0, sleepNights: 0, hrvTotal: 0, hrvNights: 0 });
  }
  const row = (date: string) => rows.get(weekStart(date));
  for (const a of acts ?? []) {
    const r = row(a.local_date);
    if (r) {
      r.sessions++;
      r.trainingS += a.duration_s ?? 0;
    }
  }
  for (const s of sleep ?? []) {
    const r = row(s.local_date);
    if (r && s.total_sleep_s) {
      r.sleepTotal += s.total_sleep_s;
      r.sleepNights++;
    }
  }
  for (const h of hrv ?? []) {
    const r = row(h.local_date);
    if (r && h.last_night_avg_ms) {
      r.hrvTotal += h.last_night_avg_ms;
      r.hrvNights++;
    }
  }
  for (const l of load ?? []) {
    const r = row(l.local_date);
    if (r && l.value) r.load += l.value;
  }
  const table = [...rows.values()].reverse();
  const maxLoad = Math.max(1, ...table.map((r) => r.load));

  const insights = (weekly ?? []).filter((w) => w.validator_ok).map((w) => w.body as Insight);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-8 sm:py-10">
      <header className="space-y-3">
        <AppNav current="/week" />
        <h1 className="text-2xl font-semibold tracking-tight">Week</h1>
      </header>

      {insights.map((insight) => (
        <InsightCard key={insight.forDate} insight={insight} />
      ))}

      <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-sm font-medium text-muted">Last {WEEKS} weeks</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-1 pr-3 font-normal">Week of</th>
                <th className="py-1 pr-3 font-normal">Sessions</th>
                <th className="py-1 pr-3 font-normal">Time</th>
                <th className="w-1/3 py-1 pr-3 font-normal">Training load</th>
                <th className="py-1 pr-3 font-normal">Avg sleep</th>
                <th className="py-1 font-normal">Avg HRV</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {table.map((r) => (
                <tr key={r.monday}>
                  <td className="py-2 pr-3">
                    {weekLabel(r.monday)}
                    {r.monday === thisMonday && <span className="text-muted"> (now)</span>}
                  </td>
                  <td className="py-2 pr-3">{r.sessions}</td>
                  <td className="py-2 pr-3">{r.trainingS ? formatDuration(r.trainingS) : "—"}</td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                        <span className="block h-full rounded-full bg-accent" style={{ width: `${(r.load / maxLoad) * 100}%` }} />
                      </span>
                      <span className="w-8 text-right">{formatNumber(r.load)}</span>
                    </div>
                  </td>
                  <td className="py-2 pr-3">{r.sleepNights ? formatDuration(r.sleepTotal / r.sleepNights) : "—"}</td>
                  <td className="py-2">{r.hrvNights ? `${formatNumber(r.hrvTotal / r.hrvNights)} ms` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          Training load is our estimate (Edwards TRIMP); sleep and HRV are your watch&rsquo;s nightly values.
        </p>
      </section>
    </main>
  );
}
