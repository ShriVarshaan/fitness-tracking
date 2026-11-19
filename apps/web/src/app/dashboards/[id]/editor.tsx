"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CHART_METRICS, METRIC_BY_CODE, panelId, PERIODS, type Panel } from "@/lib/dashboard";
import { saveDashboard } from "../actions";

const input = "w-full rounded-md border border-border bg-background px-2.5 py-2 text-sm";
const GROUPS = [...new Set(CHART_METRICS.map((m) => m.group))];
const PERIOD_LABEL: Record<number, string> = { 30: "30 days", 90: "90 days", 182: "6 months", 365: "1 year" };

export function DashboardEditor({ id, name: initialName, panels: initial }: { id: number; name: string; panels: Panel[] }) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [panels, setPanels] = useState<Panel[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const update = (i: number, patch: Partial<Panel>) => setPanels((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  const move = (i: number, d: -1 | 1) =>
    setPanels((ps) => {
      const j = i + d;
      if (j < 0 || j >= ps.length) return ps;
      const out = [...ps];
      [out[i], out[j]] = [out[j]!, out[i]!];
      return out;
    });

  return (
    <div className="space-y-5">
      <label className="block max-w-sm space-y-1 text-sm">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={input} />
      </label>

      <ol className="space-y-3">
        {panels.map((p, i) => {
          const unit = METRIC_BY_CODE.get(p.metrics[0]!)?.unit;
          return (
            <li key={p.id} className="space-y-3 rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium">Chart {i + 1}</span>
                <span className="flex gap-1 text-muted">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="px-1.5 disabled:opacity-30" aria-label={`Move chart ${i + 1} up`}>
                    ↑
                  </button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === panels.length - 1} className="px-1.5 disabled:opacity-30" aria-label={`Move chart ${i + 1} down`}>
                    ↓
                  </button>
                  <button type="button" onClick={() => setPanels((ps) => ps.filter((_, j) => j !== i))} className="px-1.5" aria-label={`Remove chart ${i + 1}`}>
                    ✕
                  </button>
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {[0, 1, 2].map((slot) => (
                  <label key={slot} className="space-y-1 text-xs text-muted">
                    <span>{slot === 0 ? "Metric" : `Add another (same unit, ${unit})`}</span>
                    <select
                      value={p.metrics[slot] ?? ""}
                      disabled={slot > 0 && (p.compare || !p.metrics[slot - 1])}
                      onChange={(e) => {
                        const v = e.target.value;
                        const next = [...p.metrics];
                        if (slot === 0) {
                          // A new first metric with a different unit clears the others: one y-axis per chart.
                          const u = METRIC_BY_CODE.get(v)?.unit;
                          update(i, { metrics: [v, ...next.slice(1).filter((c) => METRIC_BY_CODE.get(c)?.unit === u)] });
                        } else {
                          if (v) next[slot] = v;
                          else next.splice(slot);
                          update(i, { metrics: [...new Set(next.filter(Boolean))] });
                        }
                      }}
                      className={input}
                    >
                      {slot > 0 && <option value="">None</option>}
                      {GROUPS.map((g) => (
                        <optgroup key={g} label={g}>
                          {CHART_METRICS.filter((m) => m.group === g && (slot === 0 || m.unit === unit)).map((m) => (
                            <option key={m.code} value={m.code}>
                              {m.label} ({m.badge === "Estimate" ? "estimate" : m.badge === "Garmin" ? "Garmin" : "yours"})
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <label className="space-y-1 text-xs text-muted">
                  <span>Period</span>
                  <select value={p.periodDays} onChange={(e) => update(i, { periodDays: Number(e.target.value) as Panel["periodDays"] })} className={input}>
                    {PERIODS.map((d) => (
                      <option key={d} value={d}>
                        {PERIOD_LABEL[d]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-xs text-muted">
                  <span>Points</span>
                  <select value={p.granularity} onChange={(e) => update(i, { granularity: e.target.value as Panel["granularity"] })} className={input}>
                    <option value="day">Daily</option>
                    <option value="week">Weekly</option>
                  </select>
                </label>
                <label className="space-y-1 text-xs text-muted">
                  <span>Chart</span>
                  <select value={p.chart} onChange={(e) => update(i, { chart: e.target.value as Panel["chart"] })} className={input}>
                    <option value="line">Line</option>
                    <option value="bar">Bars</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <input
                    type="checkbox"
                    checked={p.compare}
                    disabled={p.metrics.length > 1}
                    onChange={(e) => update(i, { compare: e.target.checked })}
                    className="size-4 accent-[var(--accent)]"
                  />
                  Compare with the period before
                </label>
              </div>
              <label className="block space-y-1 text-xs text-muted">
                <span>Title (optional)</span>
                <input value={p.title ?? ""} maxLength={60} onChange={(e) => update(i, { title: e.target.value })} className={input} />
              </label>
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={panels.length >= 12}
          onClick={() => setPanels((ps) => [...ps, { id: panelId(), metrics: ["steps"], periodDays: 90, granularity: "week", chart: "bar", compare: false }])}
          className="rounded-md border border-border px-3 py-2 text-sm"
        >
          + Add chart
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await saveDashboard({ id, name, panels: panels.map((p) => ({ ...p, title: p.title?.trim() || undefined })) });
              if (res.ok) {
                router.push(`/dashboards/${id}`);
                router.refresh();
              } else setError(res.message ?? "Couldn't save.");
            })
          }
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save dashboard"}
        </button>
        {error && <span className="text-sm text-danger">{error}</span>}
      </div>
      <p className="text-xs text-muted">Each chart has one scale, so metrics on the same chart must share a unit. To compare different units, put them on separate charts.</p>
    </div>
  );
}
