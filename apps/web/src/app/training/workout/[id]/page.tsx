import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { localNow } from "@ft/core";
import { AppNav } from "@/components/app-nav";
import { formatDay, formatDuration } from "@/lib/format";
import type { Step } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";
import { deleteWorkout } from "../../actions";
import { WorkoutBuilder, type WorkoutDraft } from "./builder";

export const metadata: Metadata = { title: "Workout" };

const STEP_TEXT: Record<Step["kind"], string> = { warmup: "Warm up", work: "Work", recover: "Recover", cooldown: "Cool down" };

export default async function WorkoutPage(props: PageProps<"/training/workout/[id]">) {
  const { id } = await props.params;
  const supabase = await createClient();
  let draft: WorkoutDraft;

  if (id === "new") {
    const { data: prof } = await supabase.from("profile").select("timezone").maybeSingle();
    const raw = (await props.searchParams).date;
    const date = typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : localNow((prof?.timezone as string | undefined) ?? "Europe/London").date;
    draft = { id: null, date, sport: "running", title: "", intensity: "easy", targetDurationS: null, targetDistanceM: null, steps: [], notes: null };
  } else {
    if (!/^\d{1,18}$/.test(id)) notFound();
    // RLS: only the user's own workouts are visible.
    const { data } = await supabase.from("planned_workouts").select("*").eq("id", Number(id)).maybeSingle();
    if (!data) notFound();
    draft = {
      id: data.id as number,
      date: data.local_date as string,
      sport: data.sport as WorkoutDraft["sport"],
      title: data.title as string,
      intensity: data.intensity as WorkoutDraft["intensity"],
      targetDurationS: (data.target_duration_s as number | null) ?? null,
      targetDistanceM: (data.target_distance_m as number | null) ?? null,
      steps: (data.steps as Step[]) ?? [],
      notes: (data.notes as string | null) ?? null,
    };
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-4 py-8 sm:py-10">
      <header className="space-y-3">
        <AppNav current="/training" />
        <Link href={`/training?week=${draft.date}`} className="text-sm text-muted underline">
          ← Training
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{draft.id ? draft.title : "New workout"}</h1>
        {draft.id && (
          <p className="text-sm text-muted">
            {formatDay(draft.date)} · {draft.intensity}
            {draft.targetDurationS ? ` · ${formatDuration(draft.targetDurationS)}` : ""}
          </p>
        )}
      </header>

      {draft.id && draft.steps.length > 0 && (
        <section className="space-y-2 rounded-lg border border-border bg-surface p-5">
          <h2 className="text-sm font-medium text-muted">The session</h2>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {draft.steps.map((s, i) => (
              <li key={i}>
                {STEP_TEXT[s.kind]}
                {s.repeat && s.repeat > 1 ? ` ${s.repeat} ×` : ""} {s.durationS ? formatDuration(s.durationS) : s.distanceM ? `${s.distanceM / 1000} km` : ""}
                {s.target && <span className="text-muted"> · {s.target}</span>}
              </li>
            ))}
          </ol>
          {draft.notes && <p className="text-sm text-muted">{draft.notes}</p>}
        </section>
      )}

      <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
        <h2 className="font-medium">{draft.id ? "Edit" : "Build the workout"}</h2>
        <WorkoutBuilder initial={draft} />
      </section>

      {draft.id && (
        <form action={deleteWorkout}>
          <input type="hidden" name="id" value={draft.id} />
          <button type="submit" className="text-sm text-danger underline">
            Delete this workout
          </button>
        </form>
      )}
    </main>
  );
}
