import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { localNow } from "@ft/core";
import { AppNav } from "@/components/app-nav";
import { TrendChart } from "@/components/trend-chart";
import { sportName } from "@/lib/activity";
import { formatDay, formatDuration, formatNumber } from "@/lib/format";
import { daysCovered, firstOfYear, lastOfYear, monthStarts, recap } from "@/lib/recap";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Year in review" };

export default async function RecapPage(props: PageProps<"/recap">) {
  // Every read goes through the user's session (RLS: own rows only).
  const supabase = await createClient();
  const [{ data: prof }, { data: first }, { data: last }] = await Promise.all([
    supabase.from("profile").select("timezone").maybeSingle(),
    supabase.from("daily_summaries").select("local_date").order("local_date").limit(1).maybeSingle(),
    supabase.from("daily_summaries").select("local_date").order("local_date", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const today = localNow((prof?.timezone as string | undefined) ?? "Europe/London").date;
  const firstYear = first ? Number((first.local_date as string).slice(0, 4)) : null;
  const lastYear = last ? Number((last.local_date as string).slice(0, 4)) : null;
  const years = firstYear && lastYear ? Array.from({ length: lastYear - firstYear + 1 }, (_, k) => lastYear - k) : [];
  const raw = Number((await props.searchParams).year);
  const year = years.includes(raw) ? raw : (years[0] ?? Number(today.slice(0, 4)));

  if (!years.length) {
    return (
      <Shell year={year} years={[]}>
        <p className="rounded-lg border border-border bg-surface p-5 text-sm text-muted">No data yet. Connect Garmin or load demo data from the Today page.</p>
      </Shell>
    );
  }

  const from = firstOfYear(year);
  const to = lastOfYear(year);
  const [{ data: acts }, { data: days }, { data: sleep }, { data: hrv }] = await Promise.all([
    supabase.from("activities").select("source_record_id, local_date, sport, duration_s, distance_m, ascent_m, name").gte("local_date", from).lte("local_date", to).limit(2000),
    supabase.from("daily_summaries").select("local_date, steps, intensity_min_moderate, intensity_min_vigorous, resting_hr").gte("local_date", from).lte("local_date", to).limit(1000),
    supabase.from("sleep_sessions").select("local_date, total_sleep_s").gte("local_date", from).lte("local_date", to).limit(1000),
    supabase.from("hrv_daily").select("local_date, last_night_avg_ms").gte("local_date", from).lte("local_date", to).limit(1000),
  ]);

  const r = recap({
    year,
    activities: (acts ?? []).map((a) => ({
      id: a.source_record_id as string,
      date: a.local_date as string,
      sport: a.sport as string,
      durationS: a.duration_s as number | null,
      distanceM: a.distance_m as number | null,
      ascentM: a.ascent_m as number | null,
      name: a.name as string | null,
    })),
    days: (days ?? []).map((d) => ({ date: d.local_date as string, steps: d.steps as number | null, moderate: d.intensity_min_moderate as number | null, vigorous: d.intensity_min_vigorous as number | null })),
    sleep: (sleep ?? []).flatMap((s) => (typeof s.total_sleep_s === "number" && s.total_sleep_s > 0 ? [{ date: s.local_date as string, totalS: s.total_sleep_s }] : [])),
    hrv: (hrv ?? []).flatMap((h) => (typeof h.last_night_avg_ms === "number" ? [{ date: h.local_date as string, ms: h.last_night_avg_ms }] : [])),
    rhr: (days ?? []).flatMap((d) => (typeof d.resting_hr === "number" ? [{ date: d.local_date as string, bpm: d.resting_hr }] : [])),
  });
  const soFar = today.startsWith(`${year}-`);
  const covered = daysCovered(year, today);

  return (
    <Shell year={year} years={years}>
      <p className="text-sm text-muted">
        {soFar ? `${year} so far: ${covered} days.` : `${year}.`} Activity totals are from your recorded sessions; recovery figures are your watch&rsquo;s nightly values.
      </p>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Sessions" value={formatNumber(r.sessions)} />
        <Stat label="Training time" value={`${formatNumber(r.hours)} h`} />
        <Stat label="Distance" value={`${formatNumber(r.km)} km`} />
        {r.ascentM > 0 ? <Stat label="Climbing" value={`${formatNumber(r.ascentM)} m`} /> : <Stat label="Active days" value={formatNumber(r.activeDays)} />}
      </section>

      <Card title="Training time by month">
        <TrendChart
          title="Hours per month"
          labels={monthStarts(year)}
          unit="h"
          digits={1}
          series={[{ name: "Training time", slot: 1, kind: "bar", values: r.monthlyHours.map((h, m) => (soFar && m > Number(today.slice(5, 7)) - 1 ? null : h)) }]}
        />
      </Card>

      {r.bySport.length > 0 && (
        <Card title="By sport">
          <table className="w-full text-sm tabular-nums">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="py-1 pr-3 font-normal">Sport</th>
                <th className="py-1 pr-3 font-normal">Sessions</th>
                <th className="py-1 pr-3 font-normal">Time</th>
                <th className="py-1 font-normal">Distance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {r.bySport.map((s) => (
                <tr key={s.sport}>
                  <td className="py-1.5 pr-3">{sportName(s.sport)}</td>
                  <td className="py-1.5 pr-3">{s.sessions}</td>
                  <td className="py-1.5 pr-3">{formatDuration(s.hours * 3600)}</td>
                  <td className="py-1.5">{s.km >= 0.1 ? `${formatNumber(s.km, 1)} km` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card title="Highlights">
        <ul className="space-y-2 text-sm">
          {r.longestSession && (
            <Highlight label="Longest session">
              <Link href={`/activities/${r.longestSession.id}`} className="underline-offset-4 hover:underline">
                {r.longestSession.name ?? sportName(r.longestSession.sport)}
              </Link>
              , {formatDuration(r.longestSession.durationS)} on {formatDay(r.longestSession.date)}
            </Highlight>
          )}
          {r.furthestSession && r.furthestSession.id !== r.longestSession?.id && (
            <Highlight label="Furthest">
              <Link href={`/activities/${r.furthestSession.id}`} className="underline-offset-4 hover:underline">
                {r.furthestSession.name ?? sportName(r.furthestSession.sport)}
              </Link>
              , {formatNumber((r.furthestSession.distanceM ?? 0) / 1000, 1)} km on {formatDay(r.furthestSession.date)}
            </Highlight>
          )}
          {r.biggestWeek && (
            <Highlight label="Biggest week">
              {formatDuration(r.biggestWeek.hours * 3600)} of training, week of {formatDay(r.biggestWeek.monday)}
            </Highlight>
          )}
          {r.longestStreak && (
            <Highlight label="Longest streak">
              {r.longestStreak.days} days in a row with a session, {formatDay(r.longestStreak.from)} to {formatDay(r.longestStreak.to)}
            </Highlight>
          )}
          {r.steps.daysRecorded > 0 && (
            <Highlight label="Steps">
              {formatNumber(r.steps.total)} in total
              {r.steps.bestDay && (
                <>
                  ; best day {formatNumber(r.steps.bestDay.steps)} on {formatDay(r.steps.bestDay.date)}
                </>
              )}
            </Highlight>
          )}
          {r.whoWeeks.of > 0 && (
            <Highlight label="Activity guideline">
              {r.whoWeeks.met} of {r.whoWeeks.of} weeks reached the WHO&rsquo;s 150 minutes (vigorous minutes counted double)
            </Highlight>
          )}
          {r.sleep && (
            <Highlight label="Sleep">
              {formatDuration(r.sleep.avgS)} a night on average, over {r.sleep.nights} nights
            </Highlight>
          )}
          {r.hrvChange && (
            <Highlight label="Overnight HRV">
              {formatNumber(r.hrvChange.from)} ms on average early in the year, {formatNumber(r.hrvChange.to)} ms recently (first and last quarter of readings)
            </Highlight>
          )}
          {r.rhrChange && (
            <Highlight label="Resting heart rate">
              {formatNumber(r.rhrChange.from)} bpm early in the year, {formatNumber(r.rhrChange.to)} bpm recently
            </Highlight>
          )}
        </ul>
        {r.sessions === 0 && <p className="text-sm text-muted">No sessions recorded in {year}.</p>}
      </Card>
    </Shell>
  );
}

function Shell({ year, years, children }: { year: number; years: number[]; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-8 sm:py-10">
      <header className="space-y-3">
        <AppNav current="/recap" />
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Your {year} in review</h1>
          {years.length > 1 && (
            <nav aria-label="Year" className="flex gap-1 rounded-md border border-border bg-surface p-0.5 text-sm">
              {years.map((y) => (
                <Link key={y} href={`/recap?year=${y}`} aria-current={y === year ? "page" : undefined} className={`rounded px-2.5 py-1 ${y === year ? "bg-accent text-accent-fg" : "text-muted hover:text-foreground"}`}>
                  {y}
                </Link>
              ))}
            </nav>
          )}
        </div>
      </header>
      {children}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
      <h2 className="font-medium">{title}</h2>
      {children}
    </section>
  );
}

function Highlight({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="grid gap-x-4 sm:grid-cols-[10rem_1fr]">
      <span className="text-muted">{label}</span>
      <span>{children}</span>
    </li>
  );
}
