"use client";

import { useActionState } from "react";
import { saveFeedback, type FeedbackState } from "./feedback-actions";

/** Borg CR-10 anchors (Foster et al. 2001's session-RPE scale). */
const ANCHORS: Record<number, string> = {
  1: "Very easy",
  2: "Easy",
  3: "Moderate",
  4: "Somewhat hard",
  5: "Hard",
  7: "Very hard",
  10: "Maximal",
};

export function FeedbackForm({ id, source, rpe, note, watchRpe }: { id: string; source: string; rpe: number | null; note: string | null; watchRpe: number | null }) {
  const [state, action, pending] = useActionState<FeedbackState, FormData>(saveFeedback, { status: "idle" });
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="source" value={source} />
      <fieldset>
        <legend className="text-sm">How hard did the whole session feel?</legend>
        <div className="mt-2 grid grid-cols-5 gap-1.5 sm:grid-cols-10">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <label key={n} className="cursor-pointer">
              <input type="radio" name="rpe" value={n} defaultChecked={rpe === n} className="peer sr-only" />
              <span className="flex h-10 items-center justify-center rounded-md border border-border text-sm tabular-nums peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-fg peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
                {n}
              </span>
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-muted">
          {Object.entries(ANCHORS)
            .map(([n, t]) => `${n} ${t.toLowerCase()}`)
            .join(" · ")}
          {watchRpe != null && rpe == null && ` · Your watch recorded ${watchRpe}.`}
        </p>
      </fieldset>
      <label className="block space-y-1">
        <span className="text-sm">Note (optional)</span>
        <textarea
          name="note"
          defaultValue={note ?? ""}
          maxLength={500}
          rows={2}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          placeholder="Legs heavy, windy, felt strong…"
        />
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg disabled:opacity-60">
          {pending ? "Saving…" : "Save"}
        </button>
        {state.message && (
          <span role="status" className={`text-sm ${state.status === "error" ? "text-danger" : "text-muted"}`}>
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
