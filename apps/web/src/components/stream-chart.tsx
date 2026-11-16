import { downsample, formatElapsed, robustRange, type Series } from "@/lib/streams";

/**
 * Server-rendered SVG line chart for one activity stream against elapsed time.
 * `invert` puts lower values at the top (pace: faster is higher).
 */
export function StreamChart({
  title,
  time,
  values,
  format,
  unit,
  invert = false,
  summary,
}: {
  title: string;
  time: number[];
  values: Series;
  format: (v: number) => string;
  unit: string;
  invert?: boolean;
  summary?: string;
}) {
  const range = robustRange(values);
  if (!range) return null;
  const { t, v } = downsample(time, values, 500);
  const W = 600;
  const H = 120;
  const tMax = t.at(-1) || 1;
  const x = (s: number) => (s / tMax) * W;
  const clamp = (n: number) => Math.min(range.max, Math.max(range.min, n));
  const y = (n: number) => {
    const f = (clamp(n) - range.min) / (range.max - range.min);
    return 4 + (invert ? f : 1 - f) * (H - 8);
  };

  const segments: string[] = [];
  let cur: string[] = [];
  v.forEach((val, i) => {
    if (val === null) {
      if (cur.length) segments.push(cur.join(" "));
      cur = [];
      return;
    }
    cur.push(`${cur.length ? "L" : "M"}${x(t[i]!).toFixed(1)},${y(val).toFixed(1)}`);
  });
  if (cur.length) segments.push(cur.join(" "));

  const top = invert ? range.min : range.max;
  const bottom = invert ? range.max : range.min;

  return (
    <figure className="space-y-1">
      <figcaption className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{title}</span>
        {summary && <span className="text-muted">{summary}</span>}
      </figcaption>
      <div className="grid grid-cols-[3.25rem_1fr] gap-2">
        <div className="flex flex-col justify-between py-0.5 text-right text-[11px] tabular-nums text-muted">
          <span>{format(top)}</span>
          <span>{format(bottom)}</span>
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-28 w-full rounded border border-border"
          role="img"
          aria-label={`${title} over the activity, from ${format(range.min)} to ${format(range.max)} ${unit}`}
        >
          {segments.map((d, i) => (
            <path key={i} d={d} fill="none" className="stroke-accent" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
          ))}
        </svg>
      </div>
      <div className="ml-[3.75rem] flex justify-between text-[11px] tabular-nums text-muted">
        <span>0:00</span>
        <span>{formatElapsed(tMax / 2)}</span>
        <span>{formatElapsed(tMax)}</span>
      </div>
    </figure>
  );
}
