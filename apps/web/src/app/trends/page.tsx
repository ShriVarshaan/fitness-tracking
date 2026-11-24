import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { addDays } from "@ft/core";
import { RACE_DISTANCES, sleepMidpointVariability, WHO_WEEKLY_MIN } from "@ft/metrics";
import { AppNav } from "@/components/app-nav";
import { SleepTimingChart, type TimedNight } from "@/components/sleep-timing-chart";
import { TrendChart } from "@/components/trend-chart";
import { formatDay, formatDuration, formatNumber, formatRaceTime } from "@/lib/format";
import { vendorLabel } from "@/lib/sources";
import { onePerDay, weightBadge } from "@/lib/weight";
import { cyclingPerformance, runningPerformance, type CyclingPerformance, type RunningPerformance } from "@/server/performance";
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

  const [ctl, atl, tsb, acwr, hrvBase, rhrBase, { data: days }, { data: hrv }, { data: sleep }, { data: vo2 }, { data: prof }, { data: weight }, running, cycling] =
    await Promise.all([
      derived("ctl"),
      derived("atl"),
      derived("tsb"),
      derived("acwr"),
      derived("hrv_baseline"),
      derived("rhr_baseline"),
      supabase
        .from("daily_summaries")
        .select("local_date, source, resting_hr, intensity_min_moderate, intensity_min_vigorous")
        .gte("local_date", from)
        .lte("local_date", latestDate),
      supabase.from("hrv_daily").select("local_date, last_night_avg_ms").gte("local_date", from).lte("local_date", latestDate),
      supabase
        .from("sleep_sessions")
        .select("local_date, source, start_time, end_time, tz_offset_min, total_sleep_s")
        .gte("local_date", from)
        .lte("local_date", latestDate)
        .order("end_time", { ascending: true }),
      supabase.from("vo2max_daily").select("local_date, sport, value, source").gte("local_date", from).lte("local_date", latestDate),
      supabase.from("profile").select("sleep_need_min").maybeSingle(),
      supabase.from("body_measurements").select("local_date, weight_kg, source").gte("local_date", from).lte("local_date", latestDate).order("local_date"),
      runningPerformance(supabase),
      cyclingPerformance(supabase),
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
  const weightRows = onePerDay((weight ?? []) as Array<{ local_date: string; weight_kg: number | null; source: string }>);
  const vo2Bike = align(axis, vo2Rows.filter((r) => r.sport === "cycling"), (r) => r.value);
  const dayVendor = vendorLabel(((days ?? []) as Array<{ source: string; resting_hr: number | null }>).filter((d) => d.resting_hr != null).map((d) => d.source));
  const sleepVendor = vendorLabel(nights.map((n) => (n as { source?: string }).source));
  const vo2Vendor = vendorLabel(vo2Rows.map((r) => (r as { source?: string }).source));
  const anyApple = [dayVendor, sleepVendor].some((v) => v.includes("Apple"));

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

      <Section title="Recovery" intro={`Nightly and daily values are ${anyApple ? "as your devices recorded them" : "Garmin's"}. The shaded usual range and the 7-day averages are our estimates from your own history.`}>
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
            { name: `Daily (${dayVendor})`, slot: 1, kind: "dots", values: align(axis, (days ?? []) as Array<{ local_date: string; resting_hr: number | null }>, (r) => r.resting_hr) },
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

      <Section title="Sleep" intro={`Sleep times and durations are ${sleepVendor}'s. Timing variability is our estimate.`}>
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
          badge={vo2Vendor}
          labels={axis}
          unit="ml/kg/min"
          series={[
            ...(vo2Run.some((v) => v !== null) ? [{ name: "Running", slot: 1 as const, kind: "dots" as const, values: vo2Run }] : []),
            ...(vo2Bike.some((v) => v !== null) ? [{ name: "Cycling", slot: 2 as const, kind: "dots" as const, values: vo2Bike }] : []),
          ]}
          note={vo2Vendor === "Garmin" ? "Garmin updates VO2 max after runs or rides with heart rate and GPS (or power)." : "Each device's own estimate. Garmin and Apple estimate VO2 max differently, so the two aren't directly comparable."}
        />
        {weightRows.length ? (
          <TrendChart
            title="Weight"
            badge={weightBadge(weightRows)}
            labels={axis}
            unit="kg"
            digits={1}
            series={[{ name: "Weight", slot: 1, kind: weightRows.length > 20 ? "line" : "dots", values: align(axis, weightRows, (r) => r.weight_kg) }]}
          />
        ) : (
          <div className="space-y-1">
            <p className="text-sm font-medium">Weight</p>
            <p className="text-sm text-muted">
              Not available: no weight recorded in this period. You can log it on the{" "}
              <Link href="/nutrition" className="underline">
                Nutrition
              </Link>{" "}
              page.
            </p>
          </div>
        )}
      </Section>

      {(running || cycling) && (
        <Section
          title="Performance"
          intro="From the per-second data in your activity files: your fastest stretches inside any run or ride, not only races. Training efforts are rarely all-out, so these estimates usually err on the slow side."
        >
          {running && <RunningPanel p={running} />}
          {cycling && <CyclingPanel p={cycling} />}
        </Section>
      )}

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

function RunningPanel({ p }: { p: RunningPerformance }) {
  const cs = p.criticalSpeed;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">Running</h3>
        <span className="text-xs text-muted">
          {p.activities} {p.activities === 1 ? "run" : "runs"} with distance data, {formatDay(p.from)} – {formatDay(p.to)}
        </span>
      </div>
      {p.bests.length ? (
        <table className="w-full text-sm">
          <caption className="sr-only">Best efforts and predicted race times</caption>
          <thead className="text-left text-xs text-muted">
            <tr>
              <th className="py-1 font-normal">Distance</th>
              <th className="py-1 font-normal">Best effort</th>
              <th className="py-1 font-normal">Predicted race time</th>
            </tr>
          </thead>
          <tbody>
            {RACE_DISTANCES.map((r) => {
              const best = p.bests.find((b) => Math.abs(b.key - r.m) < 1);
              const pred = p.predictions.find((x) => x.key === r.key)?.result;
              if (!best && !pred) return null;
              return (
                <tr key={r.key} className="border-t border-border">
                  <td className="py-1.5">{r.label}</td>
                  <td className="py-1.5 tabular-nums">
                    {best ? (
                      <Link href={`/activities/${best.activityId}`} className="underline decoration-border underline-offset-2">
                        {formatRaceTime(best.value)}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-1.5 tabular-nums">
                    {pred === undefined ? (
                      ""
                    ) : pred.ok ? (
                      <>
                        {formatRaceTime(pred.timeS)} <span className="text-xs text-muted">({confidenceWord(pred.confidence)}, from your {distanceLabel(pred.from.key)} best)</span>
                      </>
                    ) : (
                      <span className="text-xs text-muted">Not available: {pred.reason}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-muted">Not available: no runs with per-second distance in this period.</p>
      )}
      <p className="text-sm">
        <span className="font-medium">Critical speed: </span>
        {cs.ok ? (
          <>
            {formatPace(cs.critical)} ({formatNumber(cs.critical * 3.6, 1)} km/h), with about {formatNumber(cs.reserve, 0)} m in reserve above it ·{" "}
            <EstimateTag confidence={cs.confidence} />
          </>
        ) : (
          <span className="text-muted">not available: {cs.reason}.</span>
        )}
      </p>
      <p className="text-xs text-muted">
        Critical speed is roughly the fastest pace you can hold for 30–40 minutes. Predictions use Riegel&rsquo;s formula from
        your best effort nearest the race distance.
      </p>
    </div>
  );
}

function CyclingPanel({ p }: { p: CyclingPerformance }) {
  const cp = p.criticalPower;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">Cycling</h3>
        <span className="text-xs text-muted">
          {p.activities} {p.activities === 1 ? "ride" : "rides"} with power, {formatDay(p.from)} – {formatDay(p.to)}
        </span>
      </div>
      <p className="text-sm tabular-nums">
        Best power:{" "}
        {p.bests.map((b, i) => (
          <span key={b.key}>
            {i > 0 && " · "}
            {b.key / 60} min {formatNumber(b.value)} W
          </span>
        ))}
      </p>
      <p className="text-sm">
        <span className="font-medium">Critical power: </span>
        {cp.ok ? (
          <>
            {formatNumber(cp.critical)} W, with about {formatNumber(cp.reserve / 1000, 1)} kJ above it ·{" "}
            <EstimateTag confidence={cp.confidence} />
          </>
        ) : (
          <span className="text-muted">not available: {cp.reason}.</span>
        )}
      </p>
    </div>
  );
}

const distanceLabel = (m: number) => RACE_DISTANCES.find((r) => Math.abs(r.m - m) < 1)?.label.toLowerCase() ?? `${formatNumber(m / 1000, 1)} km`;
const confidenceWord = (c: number) => (c >= 0.8 ? "high confidence" : c >= 0.5 ? "medium confidence" : "low confidence");

function formatPace(mps: number): string {
  const s = Math.round(1000 / mps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} /km`;
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
