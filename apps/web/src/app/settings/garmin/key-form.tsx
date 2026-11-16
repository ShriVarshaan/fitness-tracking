"use client";

import { useActionState } from "react";
import { saveGarminKey, type KeyFormState } from "./actions";

const initial: KeyFormState = { status: "idle" };
const field =
  "w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-accent";

export function KeyForm() {
  const [state, action, pending] = useActionState(saveGarminKey, initial);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={action} className="space-y-3">
      <label htmlFor="apiKey" className="block text-sm font-medium">
        Personal API key
      </label>
      <input
        id="apiKey"
        name="apiKey"
        type="password"
        autoComplete="off"
        spellCheck={false}
        required
        className={`${field} font-mono`}
      />
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label htmlFor="createdOn" className="block text-sm font-medium">
            Created on
          </label>
          <input id="createdOn" name="createdOn" type="date" defaultValue={today} max={today} required className={field} />
        </div>
        <div className="space-y-1">
          <label htmlFor="lifetimeDays" className="block text-sm font-medium">
            Lasts
          </label>
          <select id="lifetimeDays" name="lifetimeDays" defaultValue="365" className={field}>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="180">180 days</option>
            <option value="365">1 year</option>
          </select>
        </div>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-accent px-3 py-2 font-medium text-accent-fg disabled:opacity-60"
      >
        {pending ? "Checking with Garmin…" : "Save key"}
      </button>
      <p
        role="status"
        aria-live="polite"
        className={`min-h-5 text-sm ${state.status === "error" ? "text-danger" : "text-muted"}`}
      >
        {state.message}
      </p>
    </form>
  );
}
