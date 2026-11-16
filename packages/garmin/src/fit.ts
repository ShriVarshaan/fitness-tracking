import { Decoder, Stream } from "@garmin/fitsdk";
import { unzipSync } from "fflate";

/**
 * Decode the original activity file Garmin returns from
 * /download-service/files/activity/{id}: a ZIP containing one .fit file.
 * Field names below were checked against real files (Nov 2026).
 */

const SEMICIRCLE_TO_DEG = 180 / 2 ** 31;
/** Route points within this distance of the start or finish are dropped (privacy). */
export const ROUTE_TRIM_M = 200;

export type Series = Array<number | null>;

export interface DecodedStreams {
  /** Seconds since the first record. */
  time_s: number[];
  hr: Series;
  speed: Series; // m/s
  altitude: Series; // m
  cadence: Series; // steps/min for running, rpm otherwise
  power: Series; // W
  distance: Series; // m
  lat: Series; // degrees, trimmed near start and finish
  lon: Series;
}

export interface DecodedLap {
  idx: number;
  startTime: Date;
  durationS: number | null;
  distanceM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgSpeedMps: number | null;
  avgPowerW: number | null;
  ascentM: number | null;
}

export interface DecodedSet {
  idx: number;
  /** Garmin's best-guess exercise category, e.g. "benchPress". */
  exercise: string | null;
  reps: number | null;
  weightKg: number | null;
  durationS: number | null;
}

export interface DecodedActivity {
  streams: DecodedStreams | null;
  laps: DecodedLap[];
  sets: DecodedSet[];
  /** Session effort on Garmin's 1–10 scale (FIT stores RPE × 10). */
  rpe: number | null;
  /** Session feel, 0 (very weak) to 100 (very strong). */
  feel: number | null;
}

type Msg = Record<string, unknown>;
const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const date = (v: unknown): Date | null => (v instanceof Date && !Number.isNaN(v.getTime()) ? v : null);

/** Extract the .fit file from Garmin's ZIP. A bare FIT file is accepted too. */
export function fitFromZip(bytes: Uint8Array): Uint8Array {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!isZip) return bytes;
  const files = unzipSync(bytes);
  const name = Object.keys(files).find((f) => f.toLowerCase().endsWith(".fit"));
  if (!name) throw new Error("activity ZIP contains no .fit file");
  return files[name]!;
}

/** Great-circle distance in metres. */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Privacy: null out route points within `trimM` metres (along the route) of the
 * start and the finish, so a home or work location isn't stored.
 */
export function trimRoute(lat: Series, lon: Series, trimM = ROUTE_TRIM_M): { lat: Series; lon: Series } {
  const along: Array<number | null> = [];
  let total = 0;
  let prev: [number, number] | null = null;
  for (let i = 0; i < lat.length; i++) {
    const la = lat[i];
    const lo = lon[i];
    if (la == null || lo == null) {
      along.push(null);
      continue;
    }
    if (prev) total += haversineM(prev[0], prev[1], la, lo);
    prev = [la, lo];
    along.push(total);
  }
  const keep = (d: number | null) => d !== null && d > trimM && d < total - trimM;
  return {
    lat: lat.map((v, i) => (keep(along[i]!) ? v : null)),
    lon: lon.map((v, i) => (keep(along[i]!) ? v : null)),
  };
}

function decodeStreams(records: Msg[], sport: string): DecodedStreams | null {
  const withTime = records.filter((r) => date(r.timestamp));
  if (withTime.length < 2) return null;
  const t0 = date(withTime[0]!.timestamp)!.getTime();
  const running = /running|walking|hiking/.test(sport);

  const lat = withTime.map((r) => {
    const v = n(r.positionLat);
    return v === null ? null : v * SEMICIRCLE_TO_DEG;
  });
  const lon = withTime.map((r) => {
    const v = n(r.positionLong);
    return v === null ? null : v * SEMICIRCLE_TO_DEG;
  });
  const trimmed = trimRoute(lat, lon);

  return {
    time_s: withTime.map((r) => Math.round((date(r.timestamp)!.getTime() - t0) / 1000)),
    hr: withTime.map((r) => n(r.heartRate)),
    speed: withTime.map((r) => n(r.enhancedSpeed) ?? n(r.speed)),
    altitude: withTime.map((r) => n(r.enhancedAltitude) ?? n(r.altitude)),
    // Running cadence in FIT is per leg; report steps per minute.
    cadence: withTime.map((r) => {
      const c = n(r.cadence);
      if (c === null) return null;
      return running ? (c + (n(r.fractionalCadence) ?? 0)) * 2 : c;
    }),
    power: withTime.map((r) => n(r.power)),
    distance: withTime.map((r) => n(r.distance)),
    lat: trimmed.lat,
    lon: trimmed.lon,
  };
}

/** Decode Garmin's activity download. `sport` is the activity's type key (e.g. "running"). */
export function decodeActivityFile(bytes: Uint8Array, sport: string): DecodedActivity {
  const { messages, errors } = new Decoder(Stream.fromByteArray(Array.from(fitFromZip(bytes)))).read();
  const m = messages as Record<string, Msg[] | undefined>;
  if (!m.recordMesgs && !m.sessionMesgs) {
    throw new Error(`not a readable activity file${errors.length ? `: ${String(errors[0])}` : ""}`);
  }

  const laps: DecodedLap[] = (m.lapMesgs ?? []).flatMap((l, i) => {
    const start = date(l.startTime);
    if (!start) return [];
    return [
      {
        idx: i,
        startTime: start,
        durationS: n(l.totalTimerTime) ?? n(l.totalElapsedTime),
        distanceM: n(l.totalDistance),
        avgHr: n(l.avgHeartRate),
        maxHr: n(l.maxHeartRate),
        avgSpeedMps: n(l.enhancedAvgSpeed) ?? n(l.avgSpeed),
        avgPowerW: n(l.avgPower),
        ascentM: n(l.totalAscent),
      },
    ];
  });

  const sets: DecodedSet[] = (m.setMesgs ?? [])
    .filter((s) => s.setType === "active")
    .map((s, i) => {
      const category = Array.isArray(s.category) ? s.category.find((c) => typeof c === "string" && c !== "unknown") : null;
      return {
        idx: i,
        exercise: typeof category === "string" ? category : null,
        reps: n(s.repetitions),
        weightKg: n(s.weight),
        durationS: n(s.duration),
      };
    });

  const session = m.sessionMesgs?.[0] ?? {};
  const rpeRaw = n(session.workoutRpe);
  return {
    streams: decodeStreams(m.recordMesgs ?? [], sport),
    laps,
    sets,
    rpe: rpeRaw === null ? null : Math.round(rpeRaw) / 10,
    feel: n(session.workoutFeel),
  };
}
