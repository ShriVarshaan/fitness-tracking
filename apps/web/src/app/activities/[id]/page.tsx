import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Insight } from "@ft/advice";
import { AppNav } from "@/components/app-nav";
import { InsightCard } from "@/components/insight-card";
import { RouteMap } from "@/components/route-map";
import { StreamChart } from "@/components/stream-chart";
import { exerciseName, formatElapsed, formatPace, toPace, type Series } from "@/lib/streams";
import { activityLoad, isCycling, pacePerKm, sportName, usesPace } from "@/lib/activity";
import { sessionRpeLoad } from "@ft/metrics";
import { FeedbackForm } from "./feedback-form";
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
  rpe: number | null;
  feel: number | null;
  file_fetched_at: string | null;
  source: string;
}

/** Local wall-clock start time from the stored instant and the activity's own offset. */
function localStart(a: Activity): string {
  const ms = Date.parse(a.start_time) + (a.tz_offset_min ?? 0) * 60_000;
  return new Date(ms).toISOString().slice(11, 16);
}

export default async function ActivityPage(props: PageProps<"/activities/[id]">) {
  const { id } = await props.params;
  // Garmin ids are numeric; demo activities use "demo-YYYY-MM-DD-sport".
  if (!/^[\w-]{1,64}$/.test(id)) notFound();

  // RLS: only the signed-in user's own activities are visible.
  const supabase = await createClient();
  const [{ data }, { data: streamRows }, { data: laps }, { data: sets }, { data: postRow }] = await Promise.all([
    supabase.from("activities").select("*").eq("source_record_id", id).maybeSingle(),
    supabase.from("activity_streams").select("stream, values").eq("source_record_id", id),
    supabase.from("activity_laps").select("*").eq("source_record_id", id).order("idx"),
    supabase.from("activity_sets").select("*").eq("source_record_id", id).order("idx"),
    supabase
      .from("insights")
      .select("body, validator_ok")
      .eq("kind", "post_workout")
      .eq("body->>activityId", id)
      .order("for_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const postWorkout = postRow?.validator_ok ? (postRow.body as Insight) : null;
  if (!data) notFound();
  const a = data as Activity;
  // Our load estimate for this activity, from the day's derived row (Garmin zones or the HR stream).
  const [{ data: loadRow }, { data: feedback }] = await Promise.all([
    supabase.from("derived_daily").select("components").eq("metric_code", "trimp_daily").eq("local_date", a.local_date).maybeSingle(),
    supabase.from("activity_feedback").select("rpe, note").eq("source", a.source).eq("source_record_id", id).maybeSingle(),
  ]);
  const rpe = (feedback?.rpe as number | null | undefined) ?? a.rpe;
  const srpe = sessionRpeLoad(rpe, a.duration_s);
  const load = activityLoad(loadRow?.components, id);
  const streams = new Map((streamRows ?? []).map((s) => [s.stream as string, s.values as Series]));

  const zones = a.hr_zone_s;
  const zoneTotal = zones?.reduce((s, z) => s + z, 0) ?? 0;

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
    ["Effort (RPE)", rpe != null ? `${formatNumber(rpe, rpe % 1 ? 1 : 0)} / 10` : null],
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

      {postWorkout && <InsightCard insight={postWorkout} />}

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

      <ActivityDetail activity={a} streams={streams} laps={(laps ?? []) as Lap[]} sets={(sets ?? []) as SetRow[]} />

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
          {load?.load != null && !load.fromStream && <LoadLine load={load.load} />}
        </section>
      )}

      {load?.load != null && load.fromStream && (
        <section className="space-y-1 rounded-lg border border-border bg-surface p-5">
          <h2 className="text-sm font-medium text-muted">Training load</h2>
          <LoadLine load={load.load} />
          <p className="text-xs text-muted">
            Garmin gave no heart-rate zones for this activity, so the zones were worked out from its per-second heart rate
            {load.hrMaxBpm ? ` against your highest recorded heart rate (${load.hrMaxBpm} bpm)` : ""}.
          </p>
        </section>
      )}

      <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium text-muted">Your rating</h2>
          {srpe !== null && (
            <span className="text-sm">
              Session effort load <strong className="font-semibold tabular-nums">{formatNumber(srpe)}</strong>{" "}
              <span className="text-xs text-muted">
                · Estimate ·{" "}
                <Link href="/methods" className="underline">
                  effort × minutes
                </Link>
              </span>
            </span>
          )}
        </div>
        <FeedbackForm id={id} source={a.source} rpe={(feedback?.rpe as number | null | undefined) ?? null} note={(feedback?.note as string | null | undefined) ?? null} watchRpe={a.rpe} />
      </section>

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

      {!zones && load?.load == null && (
        <p className="text-sm text-muted">
          Not available: heart-rate zones for this activity, so it adds nothing to the training load estimate.
        </p>
      )}
      {!a.file_fetched_at && a.source === "garmin" && (
        <p className="text-sm text-muted">Charts, laps and sets appear once the activity file has been fetched from Garmin.</p>
      )}
    </main>
  );
}

function LoadLine({ load }: { load: number }) {
  return (
    <p className="text-sm">
      Training load <strong className="font-semibold tabular-nums">{formatNumber(load)}</strong>{" "}
      <span className="text-xs text-muted">
        · Estimate ·{" "}
        <Link href="/methods" className="underline">
          our formula
        </Link>
      </span>
    </p>
  );
}

interface Lap {
  idx: number;
  duration_s: number | null;
  distance_m: number | null;
  avg_hr: number | null;
  avg_speed_mps: number | null;
  avg_power_w: number | null;
}

interface SetRow {
  idx: number;
  exercise: string | null;
  reps: number | null;
  weight_kg: number | null;
  duration_s: number | null;
}

function ActivityDetail({ activity: a, streams, laps, sets }: { activity: Activity; streams: Map<string, Series>; laps: Lap[]; sets: SetRow[] }) {
  const time = streams.get("time_s") as number[] | undefined;
  const lat = streams.get("lat");
  const lon = streams.get("lon");
  const route =
    lat && lon
      ? lat.flatMap((la, i) => {
          const lo = lon[i];
          return la != null && lo != null ? [[lo, la] as [number, number]] : [];
        })
      : [];
  const pace = usesPace(a.sport);
  const speed = streams.get("speed");

  return (
    <>
      {route.length > 1 && (
        <section className="space-y-2">
          <RouteMap coordinates={route} />
          <p className="text-xs text-muted">The first and last 200 m are hidden for privacy. Use 3D for terrain; drag with two fingers or right-click to tilt and turn.</p>
        </section>
      )}

      {time && (
        <section className="space-y-5 rounded-lg border border-border bg-surface p-5">
          {streams.get("hr") && (
            <StreamChart title="Heart rate" time={time} values={streams.get("hr")!} unit="bpm" format={(v) => `${Math.round(v)}`} summary={a.avg_hr ? `avg ${a.avg_hr} bpm` : undefined} />
          )}
          {speed && pace && (
            <StreamChart title="Pace" time={time} values={toPace(speed)} unit="per km" invert format={(v) => formatPace(v)} summary={pacePerKm(a.avg_speed_mps) ?? undefined} />
          )}
          {speed && !pace && isCycling(a.sport) && (
            <StreamChart title="Speed" time={time} values={speed.map((s) => (s === null ? null : s * 3.6))} unit="km/h" format={(v) => v.toFixed(1)} />
          )}
          {streams.get("altitude") && (
            <StreamChart title="Elevation" time={time} values={streams.get("altitude")!} unit="m" format={(v) => `${Math.round(v)} m`} />
          )}
          {streams.get("power") && (
            <StreamChart title="Power" time={time} values={streams.get("power")!} unit="W" format={(v) => `${Math.round(v)}`} summary={a.avg_power_w ? `avg ${Math.round(a.avg_power_w)} W` : undefined} />
          )}
          {streams.get("cadence") && pace && (
            <StreamChart title="Cadence" time={time} values={streams.get("cadence")!} unit="steps/min" format={(v) => `${Math.round(v)}`} />
          )}
        </section>
      )}

      {laps.length > 1 && (
        <section className="space-y-2 rounded-lg border border-border bg-surface p-5">
          <h2 className="text-sm font-medium text-muted">Laps</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-1 pr-3 font-normal">Lap</th>
                  <th className="py-1 pr-3 font-normal">Time</th>
                  <th className="py-1 pr-3 font-normal">Distance</th>
                  <th className="py-1 pr-3 font-normal">{pace ? "Pace" : "Speed"}</th>
                  <th className="py-1 pr-3 font-normal">Avg HR</th>
                  {laps.some((l) => l.avg_power_w) && <th className="py-1 font-normal">Power</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {laps.map((l) => (
                  <tr key={l.idx}>
                    <td className="py-1.5 pr-3">{l.idx + 1}</td>
                    <td className="py-1.5 pr-3">{l.duration_s ? formatElapsed(l.duration_s) : "—"}</td>
                    <td className="py-1.5 pr-3">{formatKm(l.distance_m)}</td>
                    <td className="py-1.5 pr-3">
                      {pace ? (pacePerKm(l.avg_speed_mps) ?? "—") : l.avg_speed_mps ? `${formatNumber(l.avg_speed_mps * 3.6, 1)} km/h` : "—"}
                    </td>
                    <td className="py-1.5 pr-3">{l.avg_hr ? Math.round(l.avg_hr) : "—"}</td>
                    {laps.some((x) => x.avg_power_w) && <td className="py-1.5">{l.avg_power_w ? `${Math.round(l.avg_power_w)} W` : "—"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {sets.length > 0 && <StrengthSets sets={sets} />}
    </>
  );
}

function StrengthSets({ sets }: { sets: SetRow[] }) {
  // Group consecutive sets of the same exercise.
  const groups: Array<{ exercise: string | null; sets: SetRow[] }> = [];
  for (const s of sets) {
    const last = groups.at(-1);
    if (last && last.exercise === s.exercise) last.sets.push(s);
    else groups.push({ exercise: s.exercise, sets: [s] });
  }
  const volume = sets.reduce((v, s) => v + (s.reps ?? 0) * (s.weight_kg ?? 0), 0);
  const totalReps = sets.reduce((v, s) => v + (s.reps ?? 0), 0);

  return (
    <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium text-muted">Sets</h2>
        <span className="text-sm text-muted">
          {sets.length} sets · {formatNumber(totalReps)} reps{volume > 0 && ` · ${formatNumber(volume)} kg lifted`}
        </span>
      </div>
      <ul className="space-y-3">
        {groups.map((g, i) => (
          <li key={i}>
            <p className="text-sm font-medium">{exerciseName(g.exercise)}</p>
            <p className="text-sm text-muted tabular-nums">
              {g.sets
                .map((s) =>
                  s.reps != null
                    ? `${s.reps}${s.weight_kg ? ` × ${formatNumber(s.weight_kg, s.weight_kg % 1 ? 1 : 0)} kg` : ""}`
                    : s.duration_s
                      ? formatElapsed(s.duration_s)
                      : "—",
                )
                .join(" · ")}
            </p>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted">Exercises are Garmin&rsquo;s automatic detection and may be wrong.</p>
    </section>
  );
}
