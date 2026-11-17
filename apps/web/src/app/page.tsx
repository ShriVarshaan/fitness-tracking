import Link from "next/link";
import type { ReactNode } from "react";
import { AppNav } from "@/components/app-nav";
import { InsightCard } from "@/components/insight-card";
import { Sparkline } from "@/components/sparkline";
import { formatDay, formatDuration, formatKm, formatNumber, mean, titleCase } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { loadToday, type DerivedValue, type SleepNight } from "@/server/today";
import { loadDemo, removeDemo } from "./demo-actions";
import { PendingButton } from "./settings/garmin/pending-button";

export default async function TodayPage() {
  const supabase = await createClient();
  const [{ data: auth }, data] = await Promise.all([supabase.auth.getClaims(), loadToday()]);
  const email = typeof auth?.claims.email === "string" ? auth.claims.email : null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-8 sm:py-10">
      <header className="space-y-3">
        <AppNav current="/" />
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
          <p className="min-w-0 truncate text-sm text-muted">
            {data.latestDate && <>Latest data: {formatDay(data.latestDate)} · </>}
            {email}
          </p>
        </div>
      </header>

      {data.isDemo && (
        <section role="note" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/50 bg-accent/10 p-4">
          <p className="text-sm">
            <strong className="font-semibold">Demo data.</strong> Everything here is made up, so you can see how the app works.
            Connecting Garmin replaces it with your own data.
          </p>
          <form action={removeDemo}>
            <PendingButton idle="Remove demo data" pending="Removing…" variant="danger" />
          </form>
        </section>
      )}

      {data.latestDate ? <Dashboard data={data} /> : <EmptyState connected={data.connection?.status === "active"} />}

      <footer className="space-y-1 pt-4 text-xs text-muted">
        <p>Values marked &ldquo;Garmin&rdquo; are Garmin&rsquo;s own metrics, shown as Garmin reports them.</p>
        <p>General wellness information, not medical advice.</p>
      </footer>
    </main>
  );
}

function EmptyState({ connected }: { connected: boolean }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <h2 className="font-medium">{connected ? "Your history is loading" : "Garmin isn't connected yet"}</h2>
      <p className="mt-1 text-sm text-muted">
        {connected
          ? "The first days usually appear within a few minutes. Use Sync now on the Garmin page to speed it up."
          : "Add your Garmin Personal API key to load your history."}
      </p>
      <Link href="/settings/garmin" className="mt-3 inline-block text-sm font-medium underline">
        Garmin settings
      </Link>
      {!connected && (
        <div className="mt-5 space-y-2 border-t border-border pt-4">
          <h3 className="text-sm font-medium">No Garmin watch? Try it with demo data</h3>
          <p className="text-sm text-muted">
            Loads 120 days of made-up sleep, HRV, heart rate and training, including one rough week, so every page
            has something to show. You can remove it at any time.
          </p>
          <form action={loadDemo}>
            <PendingButton idle="Load demo data" pending="Loading…" />
          </form>
        </div>
      )}
    </section>
  );
}

function Dashboard({ data }: { data: Awaited<ReturnType<typeof loadToday>> }) {
  const latest = data.latestDate!;
  const today = data.days.get(latest);
  const hrvToday = data.hrv.get(latest);
  const night = data.sleep.get(latest);
  const series = <T,>(pick: (d: string) => T | null | undefined) => data.dates.map((d) => pick(d) ?? null);

  const rhr = series((d) => data.days.get(d)?.resting_hr);
  const hrv = series((d) => data.hrv.get(d)?.last_night_avg_ms);
  const sleep = series((d) => data.sleep.get(d)?.total_sleep_s);
  const steps = series((d) => data.days.get(d)?.steps);
  const rhr7 = mean(rhr.slice(-7));
  const sleep7 = mean(sleep.slice(-7));
  const bodyBattery = series((d) => data.days.get(d)?.body_battery_high);
  const hrvLast = hrvToday?.last_night_avg_ms ?? null;
  const band =
    hrvToday?.baseline_balanced_low_ms != null && hrvToday.baseline_balanced_upper_ms != null
      ? { low: hrvToday.baseline_balanced_low_ms, high: hrvToday.baseline_balanced_upper_ms }
      : null;

  const est = (code: string) => data.derived.get(code)?.get(latest);
  const estSeries = (code: string) => series((d) => data.derived.get(code)?.get(d)?.value);
  const debt = est("sleep_debt");

  return (
    <div className="space-y-4">
      {data.insight && <InsightCard insight={data.insight} />}
      {data.postWorkout && (
        <InsightCard
          insight={data.postWorkout}
          link={data.postWorkout.activityId ? { href: `/activities/${data.postWorkout.activityId}`, label: "View the workout" } : undefined}
        />
      )}
      <ReadinessCard readiness={est("readiness")} trend={estSeries("readiness")} />
      <SleepCard night={night} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="HRV overnight" badge="Garmin">
          <Big value={formatNumber(hrvToday?.last_night_avg_ms)} unit="ms" />
          <p className="text-sm text-muted">
            {band ? `Usual range ${formatNumber(band.low)}–${formatNumber(band.high)} ms` : "No baseline yet"}
            {band && hrvLast != null && hrvLast < band.low && <span className="text-foreground"> · last night below range</span>}
            {band && hrvLast != null && hrvLast > band.high && <span className="text-foreground"> · last night above range</span>}
          </p>
          {hrvToday?.source_status && (
            <p className="text-sm text-muted">
              Status {titleCase(hrvToday.source_status)}, based on the 7-day average of{" "}
              {formatNumber(hrvToday.weekly_avg_ms)} ms
            </p>
          )}
          <Sparkline values={hrv} band={band} label="Overnight HRV, last 30 days, with Garmin's usual range shaded" />
        </Card>

        <Card title="Resting heart rate" badge="Garmin">
          <Big value={formatNumber(today?.resting_hr)} unit="bpm" />
          <p className="text-sm text-muted">7-day average {formatNumber(rhr7)} bpm</p>
          <Sparkline values={rhr} label="Resting heart rate, last 30 days" />
        </Card>

        <Card title="Body Battery" badge="Garmin">
          <Big value={`${formatNumber(today?.body_battery_low)}–${formatNumber(today?.body_battery_high)}`} />
          <p className="text-sm text-muted">Lowest and highest today · stress avg {formatNumber(today?.stress_avg)}</p>
          <Sparkline values={bodyBattery} label="Daily Body Battery high, last 30 days" />
        </Card>

        <Card title="Steps">
          <Big value={formatNumber(today?.steps)} />
          <p className="text-sm text-muted">
            {today?.steps_goal ? `Goal ${formatNumber(today.steps_goal)}` : "No goal"} · {formatKm(today?.distance_m)}
          </p>
          <Sparkline values={steps} label="Daily steps, last 30 days" />
        </Card>
      </div>

      <Card title="Sleep, last 30 nights">
        <p className="text-sm text-muted">7-night average {formatDuration(sleep7)}</p>
        <p className="text-sm">
          {debt?.value != null ? (
            <>
              Sleep debt this week <strong className="font-semibold">{formatDuration(debt.value)}</strong>{" "}
              <EstimateTag confidence={debt.confidence} />
            </>
          ) : (
            <span className="text-muted">Sleep debt not available: {String(debt?.components.reason ?? "no data")}</span>
          )}
        </p>
        <Sparkline values={sleep} label="Sleep duration, last 30 nights" />
      </Card>

      <LoadCard
        ctl={est("ctl")}
        atl={est("atl")}
        tsb={est("tsb")}
        acwr={est("acwr")}
        loads={estSeries("trimp_daily")}
        ctlTrend={estSeries("ctl")}
      />
    </div>
  );
}

const COMPONENT_LABELS: Record<string, string> = {
  hrv: "HRV",
  rhr: "Resting HR",
  sleep: "Sleep",
  regularity: "Sleep regularity",
  load: "Training load",
};

function EstimateTag({ confidence }: { confidence: number }) {
  const level = confidence >= 0.75 ? "high" : confidence >= 0.4 ? "medium" : "low";
  return (
    <span className="whitespace-nowrap text-xs text-muted">
      · Estimate ·{" "}
      <Link href="/methods" className="underline">
        our formula
      </Link>{" "}
      · {level} confidence
    </span>
  );
}

function ReadinessCard({ readiness, trend }: { readiness: DerivedValue | undefined; trend: Array<number | null> }) {
  if (!readiness || readiness.value === null) {
    return (
      <Card title="Readiness">
        <p className="text-sm text-muted">
          Not available: {String(readiness?.components.reason ?? "not enough data yet")}.
        </p>
      </Card>
    );
  }
  const parts = (readiness.components.components ?? {}) as Record<string, number>;
  const missing = (readiness.components.missing ?? []) as string[];
  return (
    <Card title="Readiness">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <Big value={formatNumber(readiness.value)} unit="/ 100" />
        <EstimateTag confidence={readiness.confidence} />
      </div>
      <ul className="space-y-1.5 pt-1">
        {Object.entries(parts).map(([key, score]) => (
          <li key={key} className="grid grid-cols-[7.5rem_1fr_2rem] items-center gap-2 text-sm">
            <span className="text-muted">{COMPONENT_LABELS[key] ?? key}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-border">
              <span className="block h-full rounded-full bg-accent" style={{ width: `${score}%` }} />
            </span>
            <span className="text-right tabular-nums">{formatNumber(score)}</span>
          </li>
        ))}
      </ul>
      {missing.length > 0 && (
        <p className="text-xs text-muted">
          Not available: {missing.map((m) => COMPONENT_LABELS[m] ?? m).join(", ")}. The score uses the rest.
        </p>
      )}
      <Sparkline values={trend} label="Readiness estimate, last 30 days" />
      <p className="text-xs text-muted">Our own heuristic, not Garmin&rsquo;s Training Readiness or Body Battery.</p>
    </Card>
  );
}

function LoadCard({
  ctl,
  atl,
  tsb,
  acwr,
  loads,
  ctlTrend,
}: {
  ctl: DerivedValue | undefined;
  atl: DerivedValue | undefined;
  tsb: DerivedValue | undefined;
  acwr: DerivedValue | undefined;
  loads: Array<number | null>;
  ctlTrend: Array<number | null>;
}) {
  const sessions = loads.filter((l) => (l ?? 0) > 0).length;
  return (
    <Card title="Training load">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-sm text-muted">{sessions} session{sessions === 1 ? "" : "s"} with heart-rate zones in 30 days</span>
        {ctl && <EstimateTag confidence={ctl.confidence} />}
      </div>
      <dl className="grid grid-cols-3 gap-2 text-center">
        {[
          ["Fitness", ctl?.value],
          ["Fatigue", atl?.value],
          ["Form", tsb?.value],
        ].map(([label, v]) => (
          <div key={label as string} className="rounded-md border border-border p-2">
            <dt className="text-xs text-muted">{label}</dt>
            <dd className="text-xl font-semibold tabular-nums">{formatNumber(v as number | null | undefined)}</dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-muted">
        {acwr?.value != null
          ? `Load spike ratio ${formatNumber(acwr.value, 2)} (0.8–1.3 is typical; descriptive only)`
          : "Load spike ratio not available: needs 28 days of history and recent training."}
      </p>
      <Sparkline values={ctlTrend} label="Fitness (chronic load), last 30 days" />
    </Card>
  );
}

function SleepCard({ night }: { night: SleepNight | undefined }) {
  if (!night) {
    return (
      <Card title="Last night">
        <p className="text-sm text-muted">Not available: no sleep recorded for this night. Was the watch worn?</p>
      </Card>
    );
  }
  const stages = [
    { key: "Deep", s: night.deep_s, cls: "bg-accent" },
    { key: "Light", s: night.light_s, cls: "bg-accent/55" },
    { key: "REM", s: night.rem_s, cls: "bg-accent/30" },
    { key: "Awake", s: night.awake_s, cls: "bg-border" },
  ];
  const total = stages.reduce((n, st) => n + (st.s ?? 0), 0) || 1;
  const need = night.sleep_need_min ? night.sleep_need_min * 60 : null;

  return (
    <Card title="Last night" badge={night.source_score != null ? "Garmin score" : undefined}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Big value={formatDuration(night.total_sleep_s)} />
        {night.source_score != null && (
          <span className="text-sm">
            Sleep score <strong className="font-semibold">{night.source_score}</strong>
            <span className="text-muted"> · {titleCase(night.source_score_qualifier)}</span>
          </span>
        )}
      </div>
      {need && <p className="text-sm text-muted">Garmin&rsquo;s sleep need for you: {formatDuration(need)}</p>}
      <div className="flex h-3 w-full overflow-hidden rounded-full" role="img" aria-label="Sleep stages">
        {stages.map((st) => (
          <div key={st.key} className={st.cls} style={{ width: `${((st.s ?? 0) / total) * 100}%` }} />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        {stages.map((st) => (
          <li key={st.key} className="flex items-center gap-1.5">
            <span className={`inline-block size-2 rounded-full ${st.cls}`} />
            {st.key} {formatDuration(st.s)}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function Card({ title, badge, children }: { title: string; badge?: string; children: ReactNode }) {
  return (
    <section className="space-y-2 rounded-lg border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-muted">{title}</h2>
        {badge && <span className="text-[11px] uppercase tracking-wide text-muted">{badge}</span>}
      </div>
      {children}
    </section>
  );
}

function Big({ value, unit }: { value: string; unit?: string }) {
  return (
    <p className="text-3xl font-semibold tabular-nums tracking-tight">
      {value}
      {unit && <span className="ml-1 text-base font-normal text-muted">{unit}</span>}
    </p>
  );
}
