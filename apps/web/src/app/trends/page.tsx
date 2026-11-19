import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { addDays } from "@ft/core";
import { sleepMidpointVariability, WHO_WEEKLY_MIN } from "@ft/metrics";
import { AppNav } from "@/components/app-nav";
import { SleepTimingChart, type TimedNight } from "@/components/sleep-timing-chart";
import { TrendChart } from "@/components/trend-chart";
import { formatDay, formatDuration } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { align, clockFromNoon, component, dateAxis, parseRange, RANGES, weeklyIntensity, type RangeKey } from "@/lib/trends";

export const metadata: Metadata = { title: "Trends" };

const RANGE_LABEL: Record<RangeKey, string> = { "90d": "90 days", "6m": "6 months", "1y": "1 year" };

interface DerivedRow {
  local_date: string;
  value: number | null;
  confidence: number;
  components: Record<string, unknown>;
}

export default async function TrendsPage(props: PageProps<"/trends">) {
  const range = parseRange((await props.searchParams).range);
  // Every read goes through the user's session, so RLS limits it to their own rows.
  const supabase = await createClient();
  const { data: latest } = await supabase.from("daily_summaries").select("local_date").order("local_date", { ascending: false }).limit(1).maybeSingle();
  const latestDate = latest?.local_date as string | undefined;

  if (!latestDate) {
    return (
      <Shell range={range}>
        <p className="rounded-lg border border-border bg-surface p-5 text-sm text-muted">
          No data yet. Connect Garmin or load demo data from the Today page.
        </p>
      </Shell>
    );
  }

  const from = addDays(latestDate, -(RANGES[range] - 1));
  const axis = dateAxis(from, latestDate);
  // One query per metric keeps each under the API's 1,000-row page.
  const derived = (code: string) =>
    supabase
      .from("derived_daily")
      .select("local_date, value, confidence, components")
      .eq("metric_code", code)
      .gte("local_date", from)
      .lte("local_date", latestDate)
      .then(({ data }) => (data ?? []) as DerivedRow[]);

  const [ctl, atl, tsb, acwr, hrvBase, rhrBase, { data: days }, { data: hrv }, { data: sleep }, { data: vo2 }, { data: prof }] =
    await Promise.all([
      derived("ctl"),
      derived("atl"),
      derived("tsb"),
      derived("acwr"),
      derived("hrv_baseline"),
      derived("rhr_baseline"),
      supabase
        .from("daily_summaries")
        .select("local_date, resting_hr, intensity_min_moderate, intensity_min_vigorous")
        .gte("local_date", from)
        .lte("local_date", latestDate),
      supabase.from("hrv_daily").select("local_date, last_night_avg_ms").gte("local_date", from).lte("local_date", latestDate),
      supabase
        .from("sleep_sessions")
        .select("local_date, start_time, end_time, tz_offset_min, total_sleep_s")
        .gte("local_date", from)
        .lte("local_date", latestDate)
        .order("end_time", { ascending: true }),
      supabase.from("vo2max_daily").select("local_date, sport, value").gte("local_date", from).lte("local_date", latestDate),
      supabase.from("profile").select("sleep_need_min").maybeSingle(),
    ]);

  const last = <T,>(rows: T[]) => rows.at(-1);
  const confidence = last(ctl)?.confidence ?? 0;
  // If a date has two sleeps, the later one (ordered by end time) wins, as on Today.
  const nights = [...new Map(((sleep ?? []) as Array<TimedNight & { total_sleep_s: number | null }>).map((s) => [s.local_date, s])).values()];
  const timing = sleepMidpointVariability(nights.map((n) => ({ start: n.start_time, end: n.end_time, tzOffsetMin: n.tz_offset_min })));
  const needS = ((prof?.sleep_need_min as number | undefined) ?? 480) * 60;
  const intensity = weeklyIntensity(axis, days ?? []);
  const vo2Rows = (vo2 ?? []) as Array<{ local_date: string; sport: string; value: number }>;
  const vo2Run = align(axis, vo2Rows.filter((r) => r.sport === "running"), (r) => r.value);
  const vo2Bike = align(axis, vo2Rows.filter((r) => r.sport === "cycling"), (r) => r.value);

  return (
    <Shell range={range}>
      <Section
        title="Fitness and fatigue"
        tag={<EstimateTag confidence={confidence} />}
        intro="Fitness is your training load averaged over about 6 weeks; fatigue over about a week. When fatigue sits above fitness you are building; when it drops below, you are freshening up."
      >
        <TrendChart
          title="Fitness and fatigue"
          labels={axis}
          unit="load"
          series={[
            { name: "Fitness (chronic load)", slot: 1, values: align(axis, ctl, (r) => r.value) },
            { name: "Fatigue (acute load)", slot: 2, values: align(axis, atl, (r) => r.value) },
          ]}
          yMin={0}
        />
        <TrendChart
          title="Form (fitness minus fatigue)"
          labels={axis}
          unit="load"
          series={[{ name: "Form", slot: 1, values: align(axis, tsb, (r) => r.value) }]}
          refLines={[{ value: 0, label: "0" }]}
          note="Positive form means fresher than your recent training; strongly negative means carrying fatigue."
        />
        <TrendChart
          title="Load spike ratio"
          labels={axis}
          unit=""
          digits={2}
          series={[{ name: "Acute:chronic ratio", slot: 1, values: align(axis, acwr, (r) => r.value) }]}
          band={{ low: axis.map(() => 0.8), high: axis.map(() => 1.3), label: "Typical range 0.8–1.3" }}
          note="Descriptive only: how this week's load compares with the last month. It is not an injury predictor."
        />
      </Section>

      <Section title="Recovery" intro="Nightly values are Garmin's. The shaded usual range and the 7-day averages are our estimates from your own history.">
        <TrendChart
          title="Overnight HRV"
          labels={axis}
          unit="ms"
          series={[
            { name: "Nightly (Garmin)", slot: 1, kind: "dots", values: align(axis, (hrv ?? []) as Array<{ local_date: string; last_night_avg_ms: number | null }>, (r) => r.last_night_avg_ms) },
            { name: "7-night average (estimate)", slot: 2, values: align(axis, hrvBase, (r) => r.value) },
          ]}
          band={{
            low: align(axis, hrvBase, (r) => component(r.components, "bandLowMs")),
            high: align(axis, hrvBase, (r) => component(r.components, "bandHighMs")),
            label: "Usual range (estimate)",
          }}
          note="Usual range: your 60-night average ± half a standard deviation, on a log scale."
        />
        <TrendChart
          title="Resting heart rate"
          labels={axis}
          unit="bpm"
          series={[
            { name: "Daily (Garmin)", slot: 1, kind: "dots", values: align(axis, (days ?? []) as Array<{ local_date: string; resting_hr: number | null }>, (r) => r.resting_hr) },
            { name: "7-day average (estimate)", slot: 2, values: align(axis, rhrBase, (r) => r.value) },
          ]}
          band={{
            low: align(axis, rhrBase, (r) => {
              const b = component(r.components, "baselineBpm");
              const sd = component(r.components, "sdBpm");
              return b === null || sd === null ? null : b - sd;
            }),
            high: align(axis, rhrBase, (r) => {
              const b = component(r.components, "baselineBpm");
              const sd = component(r.components, "sdBpm");
              return b === null || sd === null ? null : b + sd;
            }),
            label: "Usual range (estimate)",
          }}
          note="Usual range: your 60-day average ± one standard deviation."
        />
      </Section>

      <Section title="Sleep" intro="Sleep times and durations are Garmin's. Timing variability is our estimate.">
        <TrendChart
          title="Sleep duration"
          labels={axis}
          unit="h"
          digits={1}
          series={[{ name: "Sleep", slot: 1, values: align(axis, nights, (n) => (n.total_sleep_s == null ? null : n.total_sleep_s / 3600)) }]}
          refLines={[{ value: needS / 3600, label: `need ${formatDuration(needS)}` }]}
          yMin={0}
        />
        <figure className="space-y-2">
          <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium">Sleep times</span>
            <span className="text-sm text-muted">
              {timing.ok ? (
                <>
                  Midpoint usually around {clockFromNoon(timing.meanMidpointMin)}, varying by ±{formatDuration(timing.sdMin * 60)} ·{" "}
                  <EstimateTag confidence={timing.confidence} />
                </>
              ) : (
                `Timing variability not available: ${timing.reason}`
              )}
            </span>
          </figcaption>
          {nights.length ? <SleepTimingChart axis={axis} nights={nights} /> : <p className="text-sm text-muted">Not available: no sleep recorded in this period.</p>}
          <p className="text-xs text-muted">Each bar runs from falling asleep to waking. Ragged ends mean irregular timing.</p>
        </figure>
      </Section>

      <Section title="Activity and fitness">
        <TrendChart
          title="Intensity minutes per week"
          labels={intensity.weeks}
          labelPrefix="Week of "
          unit="min"
          series={[{ name: "Moderate + 2 × vigorous (Garmin)", slot: 1, kind: "bar", values: intensity.minutes }]}
          refLines={[{ value: WHO_WEEKLY_MIN, label: `WHO ${WHO_WEEKLY_MIN}` }]}
          note={`The WHO recommends at least ${WHO_WEEKLY_MIN} minutes a week of moderate activity, with vigorous minutes counting double. The first and latest weeks may be partial.`}
        />
        <TrendChart
          title="VO2 max"
          badge="Garmin"
          labels={axis}
          unit="ml/kg/min"
          series={[
            ...(vo2Run.some((v) => v !== null) ? [{ name: "Running", slot: 1 as const, kind: "dots" as const, values: vo2Run }] : []),
            ...(vo2Bike.some((v) => v !== null) ? [{ name: "Cycling", slot: 2 as const, kind: "dots" as const, values: vo2Bike }] : []),
          ]}
          note="Garmin updates VO2 max after runs or rides with heart rate and GPS (or power)."
        />
        <div className="space-y-1">
          <p className="text-sm font-medium">Weight</p>
          <p className="text-sm text-muted">Not available: no weight data from Garmin yet.</p>
        </div>
      </Section>

      <p className="text-xs text-muted">
        Latest data {formatDay(latestDate)}. How the estimates are calculated:{" "}
        <Link href="/methods" className="underline">
          methods
        </Link>
        . General wellness information, not medical advice.
      </p>
    </Shell>
  );
}

function Shell({ range, children }: { range: RangeKey; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-8 sm:py-10">
      <header className="space-y-3">
        <AppNav current="/trends" />
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Trends</h1>
          <nav aria-label="Period" className="flex gap-1 rounded-md border border-border bg-surface p-0.5 text-sm">
            {(Object.keys(RANGES) as RangeKey[]).map((k) => (
              <Link
                key={k}
                href={`/trends?range=${k}`}
                aria-current={k === range ? "page" : undefined}
                className={`rounded px-2.5 py-1 ${k === range ? "bg-accent text-accent-fg" : "text-muted hover:text-foreground"}`}
              >
                {RANGE_LABEL[k]}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      {children}
    </main>
  );
}

function Section({ title, tag, intro, children }: { title: string; tag?: ReactNode; intro?: string; children: ReactNode }) {
  return (
    <section className="space-y-5 rounded-lg border border-border bg-surface p-5">
      <div className="space-y-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-medium">{title}</h2>
          {tag}
        </div>
        {intro && <p className="text-sm text-muted">{intro}</p>}
      </div>
      {children}
    </section>
  );
}

function EstimateTag({ confidence }: { confidence: number }) {
  const level = confidence >= 0.8 ? "high" : confidence >= 0.5 ? "medium" : "low";
  return (
    <span className="text-xs text-muted">
      Estimate · {level} confidence ·{" "}
      <Link href="/methods" className="underline">
        our formula
      </Link>
    </span>
  );
}
