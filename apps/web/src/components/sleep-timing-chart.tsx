import { minutesAfterNoon } from "@ft/metrics";
import { clockFromNoon } from "@/lib/trends";

export interface TimedNight {
  local_date: string;
  start_time: string;
  end_time: string;
  tz_offset_min: number | null;
}

/** Visible clock window: 18:00 (360 min after noon) to 12:00 the next day (1440). */
const TOP = 360;
const BOTTOM = 1440;
const W = 600;
const H = 160;
const TICKS = [360, 540, 720, 900, 1080, 1260];

/**
 * One bar per night from falling asleep to waking, on a local-clock axis,
 * so irregular bedtimes show as ragged bar ends. Native tooltips per bar.
 */
export function SleepTimingChart({ axis, nights }: { axis: string[]; nights: TimedNight[] }) {
  const by = new Map(nights.map((n) => [n.local_date, n]));
  const slot = W / Math.max(1, axis.length);
  const y = (m: number) => ((Math.min(BOTTOM, Math.max(TOP, m)) - TOP) / (BOTTOM - TOP)) * H;

  return (
    <div className="grid grid-cols-[2.75rem_1fr] gap-2 pt-2">
      <div className="relative text-right text-[11px] tabular-nums text-muted" aria-hidden>
        {TICKS.map((t) => (
          <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${(y(t) / H) * 100}%` }}>
            {clockFromNoon(t)}
          </span>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-40 w-full" role="img" aria-label="Sleep times per night: a bar from falling asleep to waking, on a clock axis from 18:00 to 12:00">
        {TICKS.map((t) => (
          <line key={t} x1={0} x2={W} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}
        {axis.map((d, i) => {
          const n = by.get(d);
          if (!n) return null;
          const start = minutesAfterNoon(n.start_time, n.tz_offset_min);
          const length = (Date.parse(n.end_time) - Date.parse(n.start_time)) / 60_000;
          if (!(length > 0)) return null;
          const end = start + length;
          return (
            <rect key={d} x={i * slot + slot * 0.15} width={Math.max(0.6, slot * 0.7)} y={y(start)} height={Math.max(1, y(end) - y(start))} className="fill-series-1">
              <title>{`${d}: ${clockFromNoon(start)}–${clockFromNoon(end % 1440)}`}</title>
            </rect>
          );
        })}
      </svg>
    </div>
  );
}
