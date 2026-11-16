import Link from "next/link";
import type { ReactNode } from "react";
import { Sparkline } from "@/components/sparkline";
import { formatDay, formatDuration, formatKm, formatNumber, mean, titleCase } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { loadToday, type SleepNight } from "@/server/today";
import { SignOutButton } from "./sign-out-button";

export default async function TodayPage() {
  const supabase = await createClient();
  const [{ data: auth }, data] = await Promise.all([supabase.auth.getClaims(), loadToday()]);
  const email = typeof auth?.claims.email === "string" ? auth.claims.email : null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-8 sm:py-10">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
          {data.latestDate && <p className="text-sm text-muted">Latest data: {formatDay(data.latestDate)}</p>}
        </div>
        <nav className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <span className="truncate">{email}</span>
          <Link href="/settings/garmin" className="underline">
            Garmin
          </Link>
          <Link href="/settings/security" className="underline">
            Security
          </Link>
          <SignOutButton />
        </nav>
      </header>

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
  const band =
    hrvToday?.baseline_balanced_low_ms != null && hrvToday.baseline_balanced_upper_ms != null
      ? { low: hrvToday.baseline_balanced_low_ms, high: hrvToday.baseline_balanced_upper_ms }
      : null;

  return (
    <div className="space-y-4">
      <SleepCard night={night} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="HRV overnight" badge="Garmin">
          <Big value={formatNumber(hrvToday?.last_night_avg_ms)} unit="ms" />
          <p className="text-sm text-muted">
            {band ? `Usual range ${formatNumber(band.low)}–${formatNumber(band.high)} ms` : "No baseline yet"}
            {hrvToday?.source_status && ` · ${titleCase(hrvToday.source_status)}`}
          </p>
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
        <Sparkline values={sleep} label="Sleep duration, last 30 nights" />
      </Card>
    </div>
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
