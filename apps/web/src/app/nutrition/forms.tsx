"use client";

import { useActionState } from "react";
import { saveNutritionProfile, saveWeight, type FormState } from "./actions";

const input = "w-full rounded-md border border-border bg-background px-3 py-2 text-sm";

function Status({ state }: { state: FormState }) {
  if (!state.message) return null;
  return (
    <span role="status" className={`text-sm ${state.status === "error" ? "text-danger" : "text-muted"}`}>
      {state.message}
    </span>
  );
}

export function WeightForm({ date }: { date: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveWeight, { status: "idle" });
  return (
    <form action={action} className="grid grid-cols-3 items-end gap-3">
      <label className="space-y-1 text-sm">
        <span>Date</span>
        <input name="date" type="date" defaultValue={date} max={date} required className={input} />
      </label>
      <label className="space-y-1 text-sm">
        <span>Weight (kg)</span>
        <input name="kg" type="number" min={20} max={400} step="0.1" required className={input} />
      </label>
      <label className="space-y-1 text-sm">
        <span>Body fat % (optional)</span>
        <input name="fat" type="number" min={2} max={75} step="0.1" className={input} />
      </label>
      <div className="col-span-3 flex items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg disabled:opacity-60">
          {pending ? "Saving…" : "Save weight"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function ProfileForm({
  heightCm,
  birthYear,
  sex,
  goal,
}: {
  heightCm: number | null;
  birthYear: number | null;
  sex: string | null;
  goal: string;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveNutritionProfile, { status: "idle" });
  return (
    <form action={action} className="grid grid-cols-2 gap-3">
      <label className="space-y-1 text-sm">
        <span>Height (cm)</span>
        <input name="heightCm" type="number" min={100} max={250} step="0.5" defaultValue={heightCm ?? ""} className={input} />
      </label>
      <label className="space-y-1 text-sm">
        <span>Birth year</span>
        <input name="birthYear" type="number" min={1900} max={new Date().getFullYear() - 16} defaultValue={birthYear ?? ""} className={input} />
      </label>
      <label className="space-y-1 text-sm">
        <span>Sex (for the formula, optional)</span>
        <select name="sex" defaultValue={sex ?? ""} className={input}>
          <option value="">Prefer not to say</option>
          <option value="female">Female</option>
          <option value="male">Male</option>
        </select>
      </label>
      <label className="space-y-1 text-sm">
        <span>Goal</span>
        <select name="goal" defaultValue={goal} className={input}>
          <option value="maintain">Keep my weight</option>
          <option value="lose">Lose slowly (about 500 kcal a day less)</option>
          <option value="gain">Gain slowly (about 300 kcal a day more)</option>
        </select>
      </label>
      <div className="col-span-2 flex items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-md border border-border px-3 py-2 text-sm font-medium disabled:opacity-60">
          {pending ? "Saving…" : "Save"}
        </button>
        <Status state={state} />
      </div>
    </form>
  );
}
