import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { edwardsTrimp } from "@ft/metrics";
import { AppNav } from "@/components/app-nav";
import { isCycling, pacePerKm, sportName, usesPace } from "@/lib/activity";
import { formatDay, formatDuration, formatKm, formatNumber, titleCase } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Activity" };

interface Activity {
  source_record_id: string;
  sport: string;
  name: string | null;
  local_date: string;
  start_time: string;
  tz_offset_min: number | null;
  duration_s: number | null;
  moving_s: number | null;
  distance_m: number | null;
  ascent_m: number | null;
  descent_m: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  avg_speed_mps: number | null;
  max_speed_mps: number | null;
  avg_power_w: number | null;
  max_power_w: number | null;
  norm_power_w: number | null;
  avg_cadence: number | null;
  kcal: number | null;
  source_training_load: number | null;
  aerobic_te: number | null;
  anaerobic_te: number | null;
  training_effect_label: string | null;
  hr_zone_s: number[] | null;
  lap_count: number | null;
}

/** Local wall-clock start time from the stored instant and the activity's own offset. */
function localStart(a: Activity): string {
  const ms = Date.parse(a.start_time) + (a.tz_offset_min ?? 0) * 60_000;
  return new Date(ms).toISOString().slice(11, 16);
}

export default async function ActivityPage(props: PageProps<"/activities/[id]">) {
  const { id } = await props.params;
  if (!/^\d+$/.test(id)) notFound();

  // RLS: only the signed-in user's own activities are visible.
  const supabase = await createClient();
  const { data } = await supabase.from("activities").select("*").eq("source_record_id", id).maybeSingle();
  if (!data) notFound();
  const a = data as Activity;

  const zones = a.hr_zone_s;
  const zoneTotal = zones?.reduce((s, z) => s + z, 0) ?? 0;
  const trimp = edwardsTrimp(zones);

  const stats: Array<[string, string | null]> = [
    ["Duration", formatDuration(a.duration_s)],
    ["Moving time", a.moving_s ? formatDuration(a.moving_s) : null],
    ["Distance", a.distance_m && a.distance_m > 0 ? formatKm(a.distance_m) : null],
    ["Pace", usesPace(a.sport) ? pacePerKm(a.avg_speed_mps) : null],
    ["Speed", isCycling(a.sport) && a.avg_speed_mps ? `${formatNumber(a.avg_speed_mps * 3.6, 1)} km/h` : null],
    ["Ascent", a.ascent_m ? `${formatNumber(a.ascent_m)} m` : null],
    ["Avg heart rate", a.avg_hr ? `${a.avg_hr} bpm` : null],
    ["Max heart rate", a.max_hr ? `${a.max_hr} bpm` : null],
    ["Avg power", a.avg_power_w ? `${formatNumber(a.avg_power_w)} W` : null],
    ["Normalised power", a.norm_power_w ? `${formatNumber(a.norm_power_w)} W` : null],
    ["Cadence", a.avg_cadence ? formatNumber(a.avg_cadence) : null],
    ["Calories", a.kcal ? `${formatNumber(a.kcal)} kcal` : null],
    ["Laps", a.lap_count ? String(a.lap_count) : null],
  ];

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-8 sm:py-10">
      <header className="space-y-3">
        <AppNav current="/activities" />
        <Link href="/activities" className="text-sm text-muted underline">
          ← All activities
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{a.name ?? sportName(a.sport)}</h1>
          <p className="text-sm text-muted">
            {sportName(a.sport)} · {formatDay(a.local_date)} at {localStart(a)}
          </p>
        </div>
      </header>

      <section className="rounded-lg border border-border bg-surface p-5">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          {stats
            .filter(([, v]) => v !== null)
            .map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="text-lg font-semibold tabular-nums">{value}</dd>
              </div>
            ))}
        </dl>
      </section>

      {zones && zoneTotal > 0 && (
        <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-muted">Time in heart-rate zones</h2>
            <span className="text-[11px] uppercase tracking-wide text-muted">Garmin zones</span>
          </div>
          <ul className="space-y-1.5">
            {zones.map((s, i) => (
              <li key={i} className="grid grid-cols-[3.5rem_1fr_4rem] items-center gap-2 text-sm">
                <span className="text-muted">Zone {i + 1}</span>
                <span className="h-2 overflow-hidden rounded-full bg-border">
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${(s / zoneTotal) * 100}%`, opacity: 0.4 + i * 0.15 }} />
                </span>
                <span className="text-right tabular-nums">{formatDuration(s)}</span>
              </li>
            ))}
          </ul>
          {trimp !== null && (
            <p className="text-sm">
              Training load <strong className="font-semibold tabular-nums">{formatNumber(trimp)}</strong>{" "}
              <span className="text-xs text-muted">
                · Estimate ·{" "}
                <Link href="/methods" className="underline">
                  our formula
                </Link>
              </span>
            </p>
          )}
        </section>
      )}

      {(a.aerobic_te !== null || a.source_training_load !== null) && (
        <section className="space-y-2 rounded-lg border border-border bg-surface p-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-muted">Training effect</h2>
            <span className="text-[11px] uppercase tracking-wide text-muted">Garmin</span>
          </div>
          <dl className="grid grid-cols-3 gap-2">
            <div>
              <dt className="text-xs text-muted">Aerobic</dt>
              <dd className="text-lg font-semibold tabular-nums">{formatNumber(a.aerobic_te, 1)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Anaerobic</dt>
              <dd className="text-lg font-semibold tabular-nums">{formatNumber(a.anaerobic_te, 1)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Load</dt>
              <dd className="text-lg font-semibold tabular-nums">{formatNumber(a.source_training_load)}</dd>
            </div>
          </dl>
          {a.training_effect_label && <p className="text-sm text-muted">Primary benefit: {titleCase(a.training_effect_label)}</p>}
        </section>
      )}

      {!zones && (
        <p className="text-sm text-muted">
          Not available: heart-rate zones for this activity, so it adds nothing to the training load estimate.
        </p>
      )}
    </main>
  );
}
