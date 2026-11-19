"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { stepsDuration, type Intensity, type Sport, type Step } from "@/lib/plans";
import { saveWorkout } from "../../actions";

export interface WorkoutDraft {
  id: number | null;
  date: string;
  sport: Sport;
  title: string;
  intensity: Intensity;
  targetDurationS: number | null;
  targetDistanceM: number | null;
  steps: Step[];
  notes: string | null;
}

const input = "w-full rounded-md border border-border bg-background px-2.5 py-2 text-sm";
const STEP_LABEL: Record<Step["kind"], string> = { warmup: "Warm-up", work: "Work", recover: "Recover", cooldown: "Cool-down" };
const SPORTS: Array<[Sport, string]> = [
  ["running", "Running"],
  ["cycling", "Cycling"],
  ["swimming", "Swimming"],
  ["strength", "Strength"],
  ["walking", "Walking"],
  ["other", "Other"],
];

const toMin = (s: number | null | undefined) => (s == null ? "" : String(Math.round((s / 60) * 10) / 10));
const fromMin = (v: string) => (v.trim() === "" ? null : Math.round(Number(v) * 60));

export function WorkoutBuilder({ initial }: { initial: WorkoutDraft }) {
  const router = useRouter();
  const [w, setW] = useState<WorkoutDraft>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof WorkoutDraft>(k: K, v: WorkoutDraft[K]) => setW((p) => ({ ...p, [k]: v }));
  const setStep = (i: number, patch: Partial<Step>) => setW((p) => ({ ...p, steps: p.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const move = (i: number, d: -1 | 1) =>
    setW((p) => {
      const steps = [...p.steps];
      const j = i + d;
      if (j < 0 || j >= steps.length) return p;
      [steps[i], steps[j]] = [steps[j]!, steps[i]!];
      return { ...p, steps };
    });
  const total = stepsDuration(w.steps);

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await saveWorkout({ ...w, targetDurationS: w.targetDurationS ?? (total > 0 ? total : null) });
          if (res.ok) {
            router.push(`/training?week=${w.date}`);
            router.refresh();
          } else setError(res.message ?? "Couldn't save.");
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm sm:col-span-2">
          <span>Title</span>
          <input value={w.title} onChange={(e) => set("title", e.target.value)} required maxLength={80} className={input} placeholder="Intervals 5 × 3 min" />
        </label>
        <label className="space-y-1 text-sm">
          <span>Date</span>
          <input type="date" value={w.date} onChange={(e) => set("date", e.target.value)} required className={input} />
        </label>
        <label className="space-y-1 text-sm">
          <span>Sport</span>
          <select value={w.sport} onChange={(e) => set("sport", e.target.value as Sport)} className={input}>
            {SPORTS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span>Intensity</span>
          <select value={w.intensity} onChange={(e) => set("intensity", e.target.value as Intensity)} className={input}>
            <option value="easy">Easy</option>
            <option value="moderate">Moderate</option>
            <option value="hard">Hard</option>
            <option value="long">Long</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span>Target time (min, optional)</span>
          <input type="number" min={0} max={1440} step="any" value={toMin(w.targetDurationS)} onChange={(e) => set("targetDurationS", fromMin(e.target.value))} className={input} placeholder={total ? String(Math.round(total / 60)) : ""} />
        </label>
        <label className="space-y-1 text-sm">
          <span>Target distance (km, optional)</span>
          <input
            type="number"
            min={0}
            max={500}
            step="any"
            value={w.targetDistanceM == null ? "" : String(w.targetDistanceM / 1000)}
            onChange={(e) => set("targetDistanceM", e.target.value.trim() === "" ? null : Math.round(Number(e.target.value) * 1000))}
            className={input}
          />
        </label>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Steps {total > 0 && <span className="font-normal text-muted">· about {Math.round(total / 60)} min</span>}</legend>
        {w.steps.length === 0 && <p className="text-sm text-muted">No steps yet. Add a warm-up, the main set and a cool-down.</p>}
        <ol className="space-y-2">
          {w.steps.map((s, i) => (
            <li key={i} className="grid grid-cols-[7.5rem_4.5rem_1fr_auto] items-center gap-2 rounded-md border border-border p-2 max-sm:grid-cols-2">
              <select aria-label={`Step ${i + 1} type`} value={s.kind} onChange={(e) => setStep(i, { kind: e.target.value as Step["kind"] })} className={input}>
                {Object.entries(STEP_LABEL).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </select>
              <input aria-label={`Step ${i + 1} minutes`} type="number" min={0} step="any" value={toMin(s.durationS)} onChange={(e) => setStep(i, { durationS: fromMin(e.target.value) })} className={input} placeholder="min" />
              <input aria-label={`Step ${i + 1} target`} value={s.target ?? ""} maxLength={80} onChange={(e) => setStep(i, { target: e.target.value })} className={input} placeholder="Target, e.g. 5K effort" />
              <div className="flex items-center gap-1">
                {s.kind === "work" && (
                  <label className="flex items-center gap-1 text-xs text-muted">
                    ×
                    <input aria-label={`Step ${i + 1} repeats`} type="number" min={1} max={50} value={s.repeat ?? 1} onChange={(e) => setStep(i, { repeat: Math.max(1, Number(e.target.value) || 1) })} className="w-14 rounded-md border border-border bg-background px-2 py-2 text-sm" />
                  </label>
                )}
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="px-1.5 text-muted disabled:opacity-30" aria-label={`Move step ${i + 1} up`}>
                  ↑
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === w.steps.length - 1} className="px-1.5 text-muted disabled:opacity-30" aria-label={`Move step ${i + 1} down`}>
                  ↓
                </button>
                <button type="button" onClick={() => setW((p) => ({ ...p, steps: p.steps.filter((_, j) => j !== i) }))} className="px-1.5 text-muted" aria-label={`Remove step ${i + 1}`}>
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(STEP_LABEL) as Step["kind"][]).map((k) => (
            <button
              key={k}
              type="button"
              disabled={w.steps.length >= 30}
              onClick={() => setW((p) => ({ ...p, steps: [...p.steps, { kind: k, durationS: k === "work" ? 300 : 600, target: null, repeat: null }] }))}
              className="rounded-md border border-border px-2.5 py-1.5 text-xs"
            >
              + {STEP_LABEL[k]}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">A repeated work step repeats the recover step straight after it the same number of times.</p>
      </fieldset>

      <label className="block space-y-1 text-sm">
        <span>Notes (optional)</span>
        <textarea value={w.notes ?? ""} onChange={(e) => set("notes", e.target.value)} maxLength={500} rows={2} className={input} />
      </label>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg disabled:opacity-60">
          {pending ? "Saving…" : "Save workout"}
        </button>
        {error && <span className="text-sm text-danger">{error}</span>}
      </div>
    </form>
  );
}
