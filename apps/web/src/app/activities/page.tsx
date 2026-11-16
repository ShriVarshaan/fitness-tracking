import type { Metadata } from "next";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { pacePerKm, sportName, usesPace } from "@/lib/activity";
import { formatDay, formatDuration, formatKm, formatNumber } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Activities" };

interface Row {
  source_record_id: string;
  sport: string;
  name: string | null;
  local_date: string;
  duration_s: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  avg_speed_mps: number | null;
  source_training_load: number | null;
}

export default async function ActivitiesPage(props: PageProps<"/activities">) {
  const { sport } = (await props.searchParams) as { sport?: string };
  const supabase = await createClient();

  let query = supabase
    .from("activities")
    .select("source_record_id, sport, name, local_date, duration_s, distance_m, avg_hr, avg_speed_mps, source_training_load")
    .order("start_time", { ascending: false })
    .limit(200);
  if (sport) query = query.eq("sport", sport);

  const [{ data }, { data: sportsRows }] = await Promise.all([query, supabase.from("activities").select("sport")]);
  const rows = (data ?? []) as Row[];
  const sports = [...new Set((sportsRows ?? []).map((r) => r.sport as string))].sort();

  // Group by month, newest first.
  const months = new Map<string, Row[]>();
  for (const r of rows) {
    const key = r.local_date.slice(0, 7);
    months.set(key, [...(months.get(key) ?? []), r]);
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-8 sm:py-10">
      <header className="space-y-3">
        <AppNav current="/activities" />
        <h1 className="text-2xl font-semibold tracking-tight">Activities</h1>
      </header>

      {sports.length > 1 && (
        <nav aria-label="Filter by sport" className="flex flex-wrap gap-2 text-sm">
          <FilterLink href="/activities" active={!sport} label="All" />
          {sports.map((s) => (
            <FilterLink key={s} href={`/activities?sport=${encodeURIComponent(s)}`} active={sport === s} label={sportName(s)} />
          ))}
        </nav>
      )}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-5 text-sm text-muted">
          No activities yet. They appear here after your watch syncs with Garmin.
        </p>
      ) : (
        [...months.entries()].map(([month, list]) => (
          <section key={month} className="space-y-2">
            <h2 className="text-sm font-medium text-muted">
              {new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}
            </h2>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
              {list.map((a) => (
                <li key={a.source_record_id}>
                  <Link
                    href={`/activities/${a.source_record_id}`}
                    className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 px-4 py-3 hover:bg-background focus-visible:bg-background"
                  >
                    <span className="truncate font-medium">{a.name ?? sportName(a.sport)}</span>
                    <span className="text-right text-sm tabular-nums">{formatDuration(a.duration_s)}</span>
                    <span className="text-sm text-muted">
                      {formatDay(a.local_date)} · {sportName(a.sport)}
                    </span>
                    <span className="text-right text-sm text-muted tabular-nums">
                      {a.distance_m && a.distance_m > 0
                        ? usesPace(a.sport)
                          ? `${formatKm(a.distance_m)} · ${pacePerKm(a.avg_speed_mps) ?? ""}`
                          : formatKm(a.distance_m)
                        : a.avg_hr
                          ? `${formatNumber(a.avg_hr)} bpm avg`
                          : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}

function FilterLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-full border px-3 py-1 ${active ? "border-accent bg-accent text-accent-fg" : "border-border text-muted hover:text-foreground"}`}
    >
      {label}
    </Link>
  );
}
