import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { TrendChart, type ChartSeries } from "@/components/trend-chart";
import { METRIC_BY_CODE, panelsSchema, periodRange, rollWeekly, shiftDates, type Panel } from "@/lib/dashboard";
import { createClient } from "@/lib/supabase/server";
import { dateAxis, align } from "@/lib/trends";
import { loadMetricSeries } from "@/server/dashboard-data";
import { deleteDashboard } from "../actions";
import { DashboardEditor } from "./editor";

export const metadata: Metadata = { title: "Dashboard" };

/** Activity totals: a day with no session is a real zero, not missing data. */
const ZERO_FILL = new Set(["training_min", "run_km", "ride_km", "strength_min"]);
const SLOTS = [1, 2, 3] as const;

export default async function DashboardPage(props: PageProps<"/dashboards/[id]">) {
  const { id } = await props.params;
  if (!/^\d{1,18}$/.test(id)) notFound();
  const editing = (await props.searchParams).edit === "1";
  const supabase = await createClient();
  // RLS: only the user's own dashboards are visible.
  const { data: board } = await supabase.from("dashboards").select("id, name, panels").eq("id", Number(id)).maybeSingle();
  if (!board) notFound();
  const parsed = panelsSchema.safeParse(board.panels);
  const panels: Panel[] = parsed.success ? parsed.data : [];

  const { data: latest } = await supabase.from("daily_summaries").select("local_date").order("local_date", { ascending: false }).limit(1).maybeSingle();
  const to = (latest?.local_date as string | undefined) ?? new Date().toISOString().slice(0, 10);

  // One load for every panel: the longest period (doubled when comparing).
  const longest = Math.max(30, ...panels.map((p) => p.periodDays * (p.compare ? 2 : 1)));
  const codes = new Set(panels.flatMap((p) => p.metrics));
  const series = codes.size ? await loadMetricSeries(supabase, codes, periodRange(to, longest).from, to) : new Map();

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-8 sm:py-10">
      <header className="space-y-3">
        <AppNav current="/dashboards" />
        <Link href="/dashboards" className="text-sm text-muted underline">
          ← Dashboards
        </Link>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{board.name as string}</h1>
          <div className="flex items-center gap-3 text-sm">
            {editing ? (
              <Link href={`/dashboards/${id}`} className="text-muted underline">
                Done
              </Link>
            ) : (
              <Link href={`/dashboards/${id}?edit=1`} className="rounded-md border border-border px-3 py-1.5 font-medium">
                Edit
              </Link>
            )}
          </div>
        </div>
      </header>

      {editing && (
        <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
          <DashboardEditor id={Number(id)} name={board.name as string} panels={panels} />
          <form action={deleteDashboard}>
            <input type="hidden" name="id" value={id} />
            <button type="submit" className="text-sm text-danger underline">
              Delete this dashboard
            </button>
          </form>
        </section>
      )}

      {!panels.length && !editing && <p className="rounded-lg border border-border bg-surface p-5 text-sm text-muted">No charts yet. Choose Edit to add some.</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {panels.map((p) => (
          <section key={p.id} className="rounded-lg border border-border bg-surface p-5">
            <PanelChart panel={p} series={series} to={to} />
          </section>
        ))}
      </div>
      <p className="text-xs text-muted">
        Charts end at your latest data ({to}). Estimates are this app&rsquo;s own calculations;{" "}
        <Link href="/methods" className="underline">
          how they&rsquo;re calculated
        </Link>
        .
      </p>
    </main>
  );
}

function PanelChart({ panel, series, to }: { panel: Panel; series: Map<string, Map<string, number>>; to: string }) {
  const metrics = panel.metrics.map((c) => METRIC_BY_CODE.get(c)!);
  const first = metrics[0]!;
  const { from, prevFrom, prevTo } = periodRange(to, panel.periodDays);
  const days = dateAxis(from, to);
  const filled = (code: string, a: string, b: string) => {
    const m = series.get(code) ?? new Map<string, number>();
    if (!ZERO_FILL.has(code)) return m;
    const out = new Map(m);
    for (const d of dateAxis(a, b)) if (!out.has(d)) out.set(d, 0);
    return out;
  };
  const toSeries = (values: Map<string, number>, agg: (typeof metrics)[number]["weekly"]): { labels: string[]; values: Array<number | null> } => {
    if (panel.granularity === "week") {
      const w = rollWeekly(values, from, to, agg);
      return { labels: w.weeks, values: w.values };
    }
    return { labels: days, values: align(days, [...values].map(([local_date, v]) => ({ local_date, v })), (r) => r.v) };
  };

  const chartSeries: ChartSeries[] = [];
  let labels: string[] = days;
  metrics.forEach((m, i) => {
    const s = toSeries(filled(m.code, from, to), m.weekly);
    labels = s.labels;
    chartSeries.push({ name: m.label, slot: SLOTS[i]!, values: s.values, kind: panel.chart === "bar" ? "bar" : "line" });
  });
  if (panel.compare) {
    const prev = shiftDates(filled(first.code, prevFrom, prevTo), panel.periodDays);
    const s = toSeries(new Map([...prev].filter(([d]) => d >= from && d <= to)), first.weekly);
    chartSeries.push({ name: "Previous period", slot: 2, values: s.values, kind: panel.chart === "bar" ? "bar" : "line" });
  }
  const badges = [...new Set(metrics.map((m) => m.badge))].join(" · ");
  const period = panel.periodDays === 365 ? "year" : panel.periodDays === 182 ? "6 months" : `${panel.periodDays} days`;

  return (
    <TrendChart
      title={panel.title || `${metrics.map((m) => m.label).join(", ")} · ${panel.granularity === "week" ? "weekly" : "daily"}, last ${period}`}
      badge={badges}
      labels={labels}
      labelPrefix={panel.granularity === "week" ? "Week of " : ""}
      unit={first.unit === "steps" ? "" : first.unit}
      digits={first.digits}
      series={chartSeries}
      yMin={panel.chart === "bar" || (["steps", "km", "min", "kcal", "g", "h", "load"].includes(first.unit) && !panel.metrics.includes("tsb")) ? 0 : undefined}
    />
  );
}
