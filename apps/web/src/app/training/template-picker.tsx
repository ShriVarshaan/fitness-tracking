"use client";

import { useActionState } from "react";
import { createPlanFromTemplate, type FormState } from "./actions";

export function TemplatePicker({
  templates,
  today,
}: {
  templates: Array<{ key: string; name: string; weeks: number; daysPerWeek: number; summary: string }>;
  today: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(createPlanFromTemplate, { status: "idle" });
  return (
    <form action={action} className="space-y-4">
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="sr-only">Template</legend>
        {templates.map((t, i) => (
          <label key={t.key} className="cursor-pointer">
            <input type="radio" name="template" value={t.key} defaultChecked={i === 0} className="peer sr-only" />
            <span className="block h-full rounded-md border border-border p-3 peer-checked:border-accent peer-checked:bg-accent/10 peer-focus-visible:outline-2 peer-focus-visible:outline-accent">
              <span className="block text-sm font-medium">{t.name}</span>
              <span className="block text-xs text-muted">
                {t.weeks} weeks · {t.daysPerWeek} days a week
              </span>
              <span className="mt-1 block text-sm text-muted">{t.summary}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm">
          <span className="block">Start</span>
          <input type="date" name="start" defaultValue={today} min={today} required className="rounded-md border border-border bg-background px-3 py-2 text-sm" />
        </label>
        <button type="submit" disabled={pending} className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg disabled:opacity-60">
          {pending ? "Creating…" : "Create plan"}
        </button>
        {state.message && <span className="text-sm text-danger">{state.message}</span>}
      </div>
    </form>
  );
}
