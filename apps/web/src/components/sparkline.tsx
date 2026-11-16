/**
 * Tiny trend line (server-rendered SVG, no chart library). Gaps (null) break the line.
 * An optional band shades a normal range, e.g. Garmin's HRV baseline.
 */
export function Sparkline({
  values,
  band,
  label,
  height = 40,
}: {
  values: Array<number | null>;
  band?: { low: number; high: number } | null;
  label: string;
  height?: number;
}) {
  const width = 240;
  const real = values.filter((v): v is number => v !== null);
  if (real.length < 2) return <p className="text-xs text-muted">Not enough data for a trend yet.</p>;

  const lo = Math.min(...real, band?.low ?? Infinity);
  const hi = Math.max(...real, band?.high ?? -Infinity);
  const span = hi - lo || 1;
  const pad = 3;
  const x = (i: number) => (values.length === 1 ? width / 2 : (i / (values.length - 1)) * width);
  const y = (v: number) => pad + (1 - (v - lo) / span) * (height - pad * 2);

  // Split into segments at nulls so missing days show as gaps.
  const segments: string[] = [];
  let current: string[] = [];
  values.forEach((v, i) => {
    if (v === null) {
      if (current.length) segments.push(current.join(" "));
      current = [];
    } else {
      current.push(`${current.length ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    }
  });
  if (current.length) segments.push(current.join(" "));

  const lastIndex = values.findLastIndex((v) => v !== null);
  const last = values[lastIndex];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="h-10 w-full overflow-visible"
      role="img"
      aria-label={label}
    >
      {band && (
        <rect
          x={0}
          width={width}
          y={y(band.high)}
          height={Math.max(1, y(band.low) - y(band.high))}
          className="fill-accent/15"
        />
      )}
      {segments.map((d, i) => (
        <path key={i} d={d} fill="none" className="stroke-accent" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      ))}
      {/* A zero-length round-capped line stays circular even though the SVG stretches to fit. */}
      {last != null && (
        <path
          d={`M${x(lastIndex).toFixed(1)},${y(last).toFixed(1)}h0`}
          className="stroke-accent"
          strokeWidth={6}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      )}
    </svg>
  );
}
