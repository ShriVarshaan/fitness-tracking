"use client";

import { useId, useState, type PointerEvent } from "react";
import { chartDomain, chartTicks, formatTick } from "@/lib/chart";

export interface ChartSeries {
  name: string;
  values: Array<number | null>;
  /** Categorical slot (fixed order: 1 blue, 2 orange, 3 aqua). */
  slot: 1 | 2 | 3;
  /** Lines connect days; dots suit sparse values; bars suit weekly totals. */
  kind?: "line" | "dots" | "bar";
}

const SLOT_STROKE = { 1: "stroke-series-1", 2: "stroke-series-2", 3: "stroke-series-3" } as const;
const SLOT_FILL = { 1: "fill-series-1", 2: "fill-series-2", 3: "fill-series-3" } as const;
const SLOT_BG = { 1: "bg-series-1", 2: "bg-series-2", 3: "bg-series-3" } as const;

const W = 600;
const H = 160;
const PAD = 6;

/** "2026-11-19" → "19 Nov" (or "19 Nov 26" with the year). */
function shortDate(iso: string, year = false): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(year ? { year: "2-digit" } : {}), timeZone: "UTC" });
}

/**
 * Time-series chart with one y-axis, a crosshair tooltip and a table view.
 * Rendered as SVG stretched to the container; labels are HTML so they stay crisp.
 */
export function TrendChart({
  title,
  labels,
  series,
  unit,
  digits = 0,
  band,
  refLines = [],
  yMin,
  yMax,
  note,
  badge,
  labelPrefix = "",
}: {
  title: string;
  /** ISO dates, one per value. */
  labels: string[];
  series: ChartSeries[];
  unit: string;
  digits?: number;
  /** A shaded normal range per date (e.g. a baseline band). */
  band?: { low: Array<number | null>; high: Array<number | null>; label: string };
  refLines?: Array<{ value: number; label: string }>;
  yMin?: number;
  yMax?: number;
  note?: string;
  badge?: string;
  /** Prefix for dates in the tooltip and table, e.g. "Week of ". */
  labelPrefix?: string;
}) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const all = [
    ...series.flatMap((s) => s.values),
    ...(band ? [...band.low, ...band.high] : []),
    ...refLines.map((r) => r.value),
  ].filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const n = labels.length;
  const present = series.some((s) => s.values.some((v) => v !== null));

  if (!present || n === 0) {
    return (
      <figure className="space-y-1">
        <ChartTitle title={title} badge={badge} />
        <p className="text-sm text-muted">Not available: no data in this period.</p>
      </figure>
    );
  }

  const hasBars = series.some((s) => s.kind === "bar");
  const domain = chartDomain(all, { min: yMin ?? (hasBars ? 0 : undefined), max: yMax });
  const ticks = chartTicks(domain.min, domain.max);
  const lo = Math.min(domain.min, ticks[0]!);
  const hi = Math.max(domain.max, ticks.at(-1)!);
  const slotW = W / n;
  const x = (i: number) => (hasBars ? (i + 0.5) * slotW : n === 1 ? W / 2 : (i / (n - 1)) * W);
  const y = (v: number) => PAD + (1 - (v - lo) / (hi - lo || 1)) * (H - PAD * 2);

  const path = (values: Array<number | null>) => {
    const segs: string[] = [];
    let cur: string[] = [];
    values.forEach((v, i) => {
      if (v === null) {
        if (cur.length) segs.push(cur.join(" "));
        cur = [];
      } else cur.push(`${cur.length ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    });
    if (cur.length) segs.push(cur.join(" "));
    return segs;
  };

  const bandPath = band
    ? (() => {
        // One closed shape per run of days that have both edges.
        const shapes: string[] = [];
        let run: number[] = [];
        const flush = () => {
          if (run.length > 1) {
            const top = run.map((i) => `${x(i).toFixed(1)},${y(band.high[i]!).toFixed(1)}`);
            const bottom = [...run].reverse().map((i) => `${x(i).toFixed(1)},${y(band.low[i]!).toFixed(1)}`);
            shapes.push(`M${top.join(" L")} L${bottom.join(" L")} Z`);
          }
          run = [];
        };
        for (let i = 0; i < n; i++) {
          if (band.low[i] != null && band.high[i] != null) run.push(i);
          else flush();
        }
        flush();
        return shapes;
      })()
    : [];

  const barSeries = series.filter((s) => s.kind === "bar");
  const barW = Math.max(1, (slotW - 2) / Math.max(1, barSeries.length));

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const f = (e.clientX - rect.left) / rect.width;
    const i = hasBars ? Math.floor(f * n) : Math.round(f * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  const fmt = (v: number | null | undefined) => (v == null ? "—" : formatTick(v, digits));
  const tipLeft = hover === null ? 0 : (x(hover) / W) * 100;
  const multi = series.length > 1 || Boolean(band);
  const year = labels[0]!.slice(0, 4) !== labels.at(-1)!.slice(0, 4);

  return (
    <figure className="space-y-2">
      <ChartTitle title={title} badge={badge} />
      {multi && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
          {series.map((s) => (
            <li key={s.name} className="flex items-center gap-1.5">
              <span className={`inline-block h-0.5 w-3 rounded-full ${SLOT_BG[s.slot]}`} />
              {s.name}
            </li>
          ))}
          {band && (
            <li className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-sm bg-accent/15" />
              {band.label}
            </li>
          )}
        </ul>
      )}
      <div className="grid grid-cols-[2.75rem_1fr] gap-2">
        <div className="relative text-right text-[11px] tabular-nums text-muted" aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${(y(t) / H) * 100}%` }}>
              {formatTick(t, digits)}
            </span>
          ))}
        </div>
        <div className="relative h-40 touch-none" onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full overflow-visible" role="img" aria-labelledby={`${id}-desc`}>
            <desc id={`${id}-desc`}>
              {title}: {series.map((s) => s.name).join(", ")}, {shortDate(labels[0]!, true)} to {shortDate(labels.at(-1)!, true)}. A table view follows.
            </desc>
            {ticks.map((t) => (
              <line key={t} x1={0} x2={W} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            {bandPath.map((d, i) => (
              <path key={i} d={d} className="fill-accent/15" />
            ))}
            {refLines.map((r) => (
              <line
                key={r.label}
                x1={0}
                x2={W}
                y1={y(r.value)}
                y2={y(r.value)}
                className="stroke-muted"
                strokeWidth={1}
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {barSeries.map((s, si) =>
              s.values.map((v, i) =>
                v === null || v <= 0 ? null : (
                  <rect
                    key={`${s.name}-${i}`}
                    x={i * slotW + 1 + si * barW}
                    width={Math.max(0.5, barW - 1)}
                    y={y(v)}
                    height={Math.max(0, y(Math.max(lo, 0)) - y(v))}
                    className={SLOT_FILL[s.slot]}
                    opacity={hover === null || hover === i ? 1 : 0.55}
                  />
                ),
              ),
            )}
            {series
              .filter((s) => s.kind !== "bar")
              .map((s) =>
                s.kind === "dots"
                  ? s.values.map((v, i) =>
                      v === null ? null : (
                        <path
                          key={`${s.name}-${i}`}
                          d={`M${x(i).toFixed(1)},${y(v).toFixed(1)}h0`}
                          className={SLOT_STROKE[s.slot]}
                          strokeWidth={5}
                          strokeLinecap="round"
                          vectorEffect="non-scaling-stroke"
                        />
                      ),
                    )
                  : path(s.values).map((d, i) => (
                      <path key={`${s.name}-${i}`} d={d} fill="none" className={SLOT_STROKE[s.slot]} strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                    )),
              )}
            {hover !== null && !hasBars && (
              <line x1={x(hover)} x2={x(hover)} y1={0} y2={H} className="stroke-muted" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            )}
          </svg>
          {refLines.map((r) => (
            <span
              key={r.label}
              className="pointer-events-none absolute right-1 -translate-y-full text-[10px] text-muted"
              style={{ top: `${(y(r.value) / H) * 100}%` }}
            >
              {r.label}
            </span>
          ))}
          {hover !== null && (
            <div
              role="status"
              className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs shadow-sm"
              style={tipLeft > 60 ? { right: `${100 - tipLeft}%`, marginRight: 8 } : { left: `${tipLeft}%`, marginLeft: 8 }}
            >
              <p className="font-medium">
                {labelPrefix}
                {shortDate(labels[hover]!, year)}
              </p>
              {series.map((s) => (
                <p key={s.name} className="flex items-center justify-between gap-3 tabular-nums">
                  <span className="flex items-center gap-1.5 text-muted">
                    <span className={`inline-block size-2 rounded-full ${SLOT_BG[s.slot]}`} />
                    {s.name}
                  </span>
                  <span>
                    {fmt(s.values[hover])} {s.values[hover] != null ? unit : ""}
                  </span>
                </p>
              ))}
              {band && band.low[hover] != null && (
                <p className="text-muted tabular-nums">
                  {band.label}: {fmt(band.low[hover])}–{fmt(band.high[hover])}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="ml-[3.25rem] flex justify-between text-[11px] tabular-nums text-muted" aria-hidden>
        <span>{shortDate(labels[0]!, year)}</span>
        {n > 2 && <span>{shortDate(labels[Math.floor((n - 1) / 2)]!, year)}</span>}
        <span>{shortDate(labels.at(-1)!, year)}</span>
      </div>
      {note && <p className="text-xs text-muted">{note}</p>}
      <details className="text-xs">
        <summary className="cursor-pointer text-muted">Show as table</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full tabular-nums">
            <thead className="sticky top-0 bg-surface text-left text-muted">
              <tr>
                <th className="py-1 pr-3 font-normal">Date</th>
                {series.map((s) => (
                  <th key={s.name} className="py-1 pr-3 font-normal">
                    {s.name} ({unit})
                  </th>
                ))}
                {band && <th className="py-1 font-normal">{band.label}</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {labels.map((d, i) =>
                series.every((s) => s.values[i] == null) ? null : (
                  <tr key={d}>
                    <td className="py-1 pr-3">
                      {labelPrefix}
                      {shortDate(d, true)}
                    </td>
                    {series.map((s) => (
                      <td key={s.name} className="py-1 pr-3">
                        {fmt(s.values[i])}
                      </td>
                    ))}
                    {band && <td className="py-1">{band.low[i] != null ? `${fmt(band.low[i])}–${fmt(band.high[i])}` : "—"}</td>}
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

function ChartTitle({ title, badge }: { title: string; badge?: string }) {
  return (
    <figcaption className="flex items-baseline justify-between gap-2">
      <span className="text-sm font-medium">{title}</span>
      {badge && <span className="text-[11px] uppercase tracking-wide text-muted">{badge}</span>}
    </figcaption>
  );
}
