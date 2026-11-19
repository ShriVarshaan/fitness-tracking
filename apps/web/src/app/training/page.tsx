import type { Metadata } from "next";
import Link from "next/link";
import { addDays, localNow } from "@ft/core";
import { weekStart } from "@ft/metrics";
import { AppNav } from "@/components/app-nav";
import { sportName } from "@/lib/activity";
import { formatDuration } from "@/lib/format";
import { PLAN_TEMPLATES, sportMatches, type Sport } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";
import { deletePlan } from "./actions";
import { TemplatePicker } from "./template-picker";

export const metadata: Metadata = { title: "Training" };

const WEEKS_SHOWN = 4;
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const INTENSITY_STYLE: Record<string, string> = {
  easy: "border-l-series-3",
  moderate: "border-l-series-1",
  hard: "border-l-series-2",
  long: "border-l-series-1",
};

interface Workout {
  id: number;
  local_date: string;
  sport: Sport;
  title: string;
  intensity: string;
  target_duration_s: number | null;
}

function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export default async function TrainingPage(props: PageProps<"/training">) {
  // Reads go through the user's session (RLS: own rows only).
  const supabase = await createClient();
  const { data: prof } = await supabase.from("profile").select("timezone").maybeSingle();
  const today = localNow((prof?.timezone as string | undefined) ?? "Europe/London").date;
  const raw = (await props.searchParams).week;
  const anchor = typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : today;
  const first = weekStart(anchor);
  const last = addDays(first, WEEKS_SHOWN * 7 - 1);

  const [{ data: workouts }, { data: acts }, { data: plans }] = await Promise.all([
    supabase.from("planned_workouts").select("id, local_date, sport, title, intensity, target_duration_s").gte("local_date", first).lte("local_date", last).order("local_date"),
    supabase.from("activities").select("source_record_id, local_date, sport, duration_s").gte("local_date", first).lte("local_date", last),
    supabase.from("training_plans").select("id, name, start_date").order("start_date", { ascending: false }),
  ]);
  const byDate = new Map<string, Workout[]>();
  for (const w of (workouts ?? []) as Workout[]) byDate.set(w.local_date, [...(byDate.get(w.local_date) ?? []), w]);
  const actsByDate = new Map<string, Array<{ source_record_id: string; sport: string; duration_s: number | null }>>();
  for (const a of acts ?? []) actsByDate.set(a.local_date as string, [...(actsByDate.get(a.local_date as string) ?? []), a as { source_record_id: string; sport: string; duration_s: number | null }]);

  const weeks = Array.from({ length: WEEKS_SHOWN }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(first, w * 7 + d)));

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 px-4 py-8 sm:py-10">
      <header className="space-y-3">
        <AppNav current="/training" />
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Training</h1>
          <nav aria-label="Weeks" className="flex items-center gap-3 text-sm">
            <Link href={`/training?week=${addDays(first, -7 * WEEKS_SHOWN)}`} className="text-muted underline-offset-4 hover:underline">
              ← Earlier
            </Link>
            <Link href="/training" className="text-muted underline-offset-4 hover:underline">
              This week
            </Link>
            <Link href={`/training?week=${addDays(first, 7 * WEEKS_SHOWN)}`} className="text-muted underline-offset-4 hover:underline">
              Later →
            </Link>
            <Link href={`/training/workout/new?date=${today}`} className="rounded-md bg-accent px-3 py-1.5 font-medium text-accent-fg">
              Add workout
            </Link>
          </nav>
        </div>
        <p className="text-sm text-muted">
          Plans stay in this app: sending workouts to the watch needs Garmin&rsquo;s paid developer access. A planned session is ticked when an
          activity of the same sport is recorded that day.
        </p>
      </header>

      <section aria-label="Calendar" className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[44rem] table-fixed border-collapse text-sm">
          <thead>
            <tr>
              {DAY_NAMES.map((d) => (
                <th key={d} scope="col" className="border-b border-border px-2 py-2 text-left text-xs font-medium text-muted">
                  {d}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((days) => (
              <tr key={days[0]}>
                {days.map((d) => {
                  const planned = byDate.get(d) ?? [];
                  const done = actsByDate.get(d) ?? [];
                  const isToday = d === today;
                  return (
                    <td key={d} className={`h-28 border-b border-r border-border p-1.5 align-top last:border-r-0 ${isToday ? "bg-accent/10" : ""}`}>
                      <div className="mb-1 flex items-center justify-between">
                        <span className={`text-xs tabular-nums ${isToday ? "font-semibold" : "text-muted"}`}>{shortDate(d)}</span>
                        <Link href={`/training/workout/new?date=${d}`} className="text-xs text-muted hover:text-foreground" aria-label={`Add a workout on ${shortDate(d)}`}>
                          +
                        </Link>
                      </div>
                      <ul className="space-y-1">
                        {planned.map((w) => {
                          const completed = done.some((a) => sportMatches(w.sport, a.sport));
                          const missed = !completed && d < today;
                          return (
                            <li key={w.id}>
                              <Link
                                href={`/training/workout/${w.id}`}
                                className={`block rounded border border-border border-l-4 ${INTENSITY_STYLE[w.intensity] ?? ""} bg-background px-1.5 py-1 text-xs hover:border-foreground/40 ${missed ? "opacity-60" : ""}`}
                              >
                                <span className="line-clamp-2">
                                  {completed && <span aria-label="done">✓ </span>}
                                  {w.title}
                                </span>
                                <span className="text-muted">
                                  {w.intensity}
                                  {w.target_duration_s ? ` · ${formatDuration(w.target_duration_s)}` : ""}
                                </span>
                              </Link>
                            </li>
                          );
                        })}
                        {done
                          .filter((a) => !planned.some((w) => sportMatches(w.sport, a.sport)))
                          .map((a) => (
                            <li key={a.source_record_id}>
                              <Link href={`/activities/${a.source_record_id}`} className="block rounded px-1.5 py-0.5 text-xs text-muted hover:text-foreground">
                                ✓ {sportName(a.sport)} {a.duration_s ? formatDuration(a.duration_s) : ""}
                              </Link>
                            </li>
                          ))}
                      </ul>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-1 rounded-sm bg-series-3" /> Easy
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-1 rounded-sm bg-series-1" /> Moderate or long
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-1 rounded-sm bg-series-2" /> Hard
        </span>
        <span>✓ Done (an activity of that sport was recorded)</span>
      </p>

      {plans && plans.length > 0 && (
        <section className="space-y-2 rounded-lg border border-border bg-surface p-5">
          <h2 className="font-medium">Your plans</h2>
          <ul className="divide-y divide-border">
            {(plans as Array<{ id: number; name: string; start_date: string }>).map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <Link href={`/training?week=${p.start_date}`} className="underline-offset-4 hover:underline">
                  {p.name} <span className="text-muted">· from {shortDate(p.start_date)}</span>
                </Link>
                <form action={deletePlan}>
                  <input type="hidden" name="id" value={p.id} />
                  <button type="submit" className="text-xs text-muted underline">
                    Delete plan and its workouts
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
        <h2 className="font-medium">Start a plan</h2>
        <p className="text-sm text-muted">
          General templates: about 10% more each week, an easier week every fourth week and a lighter final week. They aren&rsquo;t
          personal coaching; adjust any session to suit you, and the morning summary will flag a hard session on a low-readiness day.
        </p>
        <TemplatePicker templates={PLAN_TEMPLATES.map(({ key, name, weeks, daysPerWeek, summary }) => ({ key, name, weeks, daysPerWeek, summary }))} today={today} />
      </section>
    </main>
  );
}
