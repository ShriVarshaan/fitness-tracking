"use client";

import { useActionState } from "react";
import { deleteAccount, saveSleepNeed, setAiWording, type FormState } from "./actions";

const initial: FormState = { status: "idle" };
const field =
  "rounded-md border border-border bg-surface px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-accent";

const OPTIONS = Array.from({ length: 25 }, (_, i) => 360 + i * 15); // 6h to 12h in 15-minute steps
const label = (min: number) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;

export function SleepNeedForm({ current }: { current: number }) {
  const [state, action, pending] = useActionState(saveSleepNeed, initial);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <label htmlFor="sleepNeedMin" className="block text-sm font-medium">
          Sleep need
        </label>
        <select id="sleepNeedMin" name="sleepNeedMin" defaultValue={current} className={field}>
          {OPTIONS.filter((m) => m <= 660).map((m) => (
            <option key={m} value={m}>
              {label(m)}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" disabled={pending} className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg disabled:opacity-60">
        {pending ? "Saving…" : "Save"}
      </button>
      <p role="status" aria-live="polite" className={`basis-full text-sm ${state.status === "error" ? "text-danger" : "text-muted"}`}>
        {state.message}
      </p>
    </form>
  );
}

export function AiWordingForm({ enabled, available, model }: { enabled: boolean; available: boolean; model: string }) {
  const [state, action, pending] = useActionState(setAiWording, initial);
  if (!available) {
    return <p className="text-sm text-muted">Not available on this server (no AI provider is configured).</p>;
  }
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="enable" value={enabled ? "0" : "1"} />
      {!enabled && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="consent" required className="mt-1 size-4 accent-accent" />
          <span>
            I agree to the numbers behind my morning summary (for example HRV, resting heart rate and sleep duration,
            with no name or email) being sent to Groq, a US company, so its model ({model}) can reword the summary.
          </span>
        </label>
      )}
      <button
        type="submit"
        disabled={pending}
        className={`rounded-md px-3 py-2 text-sm font-medium disabled:opacity-60 ${enabled ? "border border-border" : "bg-accent text-accent-fg"}`}
      >
        {pending ? "Saving…" : enabled ? "Turn AI wording off" : "Turn AI wording on"}
      </button>
      <p role="status" aria-live="polite" className={`text-sm ${state.status === "error" ? "text-danger" : "text-muted"}`}>
        {state.message}
      </p>
    </form>
  );
}

export function DeleteAccountForm() {
  const [state, action, pending] = useActionState(deleteAccount, initial);
  return (
    <form action={action} className="space-y-3">
      <label htmlFor="confirm" className="block text-sm">
        Type <strong>delete</strong> to confirm
      </label>
      <input id="confirm" name="confirm" autoComplete="off" className={`w-full ${field}`} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md border border-danger px-3 py-2 text-sm font-medium text-danger disabled:opacity-60"
      >
        {pending ? "Deleting…" : "Delete my account and all data"}
      </button>
      <p role="status" aria-live="polite" className="min-h-5 text-sm text-danger">
        {state.message}
      </p>
    </form>
  );
}
