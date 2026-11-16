import { Encoder, Profile } from "@garmin/fitsdk";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { decodeActivityFile, fitFromZip, haversineM, trimRoute } from "./fit";

// Synthetic FIT files built with Garmin's own encoder; every value is made up.
const DEG_TO_SEMI = 2 ** 31 / 180;
const T0 = new Date("2026-04-09T18:00:00Z");

// The SDK's Mesg type is narrower than the fields it actually encodes.
const write = (enc: Encoder, num: number | undefined, msg: Record<string, unknown>) => enc.onMesg(num!, msg as never);

function buildRun(): Uint8Array {
  const enc = new Encoder();
  write(enc, Profile.MesgNum.FILE_ID, { type: "activity", manufacturer: "development", product: 0, timeCreated: T0, serialNumber: 1 });
  // 1 km due north over 400 s: ~0.00899 degrees of latitude.
  for (let i = 0; i <= 400; i++) {
    write(enc, Profile.MesgNum.RECORD, {
      timestamp: new Date(T0.getTime() + i * 1000),
      positionLat: Math.round((52 + (0.008993 * i) / 400) * DEG_TO_SEMI),
      positionLong: Math.round(-1.9 * DEG_TO_SEMI),
      distance: 2.5 * i,
      enhancedSpeed: 2.5,
      enhancedAltitude: 100 + i / 100,
      heartRate: 140 + (i % 10),
      cadence: 80,
      power: 250,
    });
  }
  write(enc, Profile.MesgNum.LAP, {
    timestamp: new Date(T0.getTime() + 400_000),
    startTime: T0,
    totalTimerTime: 400,
    totalDistance: 1000,
    avgHeartRate: 145,
    maxHeartRate: 149,
    enhancedAvgSpeed: 2.5,
    avgPower: 250,
    totalAscent: 4,
  });
  write(enc, Profile.MesgNum.SESSION, {
    timestamp: new Date(T0.getTime() + 400_000),
    startTime: T0,
    sport: "running",
    totalTimerTime: 400,
    workoutRpe: 60,
    workoutFeel: 75,
  });
  return enc.close();
}

function buildStrength(): Uint8Array {
  const enc = new Encoder();
  write(enc, Profile.MesgNum.FILE_ID, { type: "activity", manufacturer: "development", product: 0, timeCreated: T0, serialNumber: 1 });
  for (let i = 0; i < 5; i++) write(enc, Profile.MesgNum.RECORD, { timestamp: new Date(T0.getTime() + i * 1000), heartRate: 100 + i });
  write(enc, Profile.MesgNum.SET, { timestamp: T0, startTime: T0, duration: 30, repetitions: 8, weight: 60, setType: "active", category: ["benchPress"] });
  write(enc, Profile.MesgNum.SET, { timestamp: T0, startTime: T0, duration: 90, setType: "rest" });
  write(enc, Profile.MesgNum.SET, { timestamp: T0, startTime: T0, duration: 25, repetitions: 10, weight: 20, setType: "active", category: ["unknown", "shoulderPress"] });
  write(enc, Profile.MesgNum.SESSION, { timestamp: new Date(T0.getTime() + 5000), startTime: T0, sport: "training" });
  return enc.close();
}

describe("haversineM", () => {
  it("measures a known distance", () => {
    expect(haversineM(52, -1.9, 52.008993, -1.9)).toBeCloseTo(1000, -1);
  });
});

describe("trimRoute", () => {
  it("removes points within 200 m of the start and the finish", () => {
    const lat = Array.from({ length: 101 }, (_, i) => 52 + (0.008993 * i) / 100); // ~10 m apart, ~1 km
    const lon = lat.map(() => -1.9);
    const out = trimRoute(lat, lon);
    const kept = out.lat.map((v, i) => (v === null ? null : i)).filter((i) => i !== null);
    expect(kept[0]).toBe(21);
    expect(kept.at(-1)).toBe(79);
    expect(out.lon[0]).toBeNull();
  });

  it("keeps nothing for a route shorter than 400 m", () => {
    const lat = [52, 52.0009, 52.0018];
    expect(trimRoute(lat, [-1.9, -1.9, -1.9]).lat.every((v) => v === null)).toBe(true);
  });
});

describe("decodeActivityFile", () => {
  it("decodes a run from Garmin's ZIP: streams, laps, effort", () => {
    const zip = zipSync({ "123_ACTIVITY.fit": buildRun() });
    const a = decodeActivityFile(zip, "running");

    expect(a.streams?.time_s).toHaveLength(401);
    expect(a.streams?.time_s.at(-1)).toBe(400);
    expect(a.streams?.hr[3]).toBe(143);
    expect(a.streams?.speed[0]).toBeCloseTo(2.5, 3);
    expect(a.streams?.cadence[0]).toBe(160); // per-leg 80 → 160 steps/min
    expect(a.streams?.distance.at(-1)).toBeCloseTo(1000, 0);

    // Privacy trim: start and finish removed, the middle kept.
    expect(a.streams?.lat[0]).toBeNull();
    expect(a.streams?.lat.at(-1)).toBeNull();
    expect(a.streams?.lat[200]).toBeCloseTo(52.0044965, 4);

    expect(a.laps).toEqual([
      expect.objectContaining({ idx: 0, durationS: 400, distanceM: 1000, avgHr: 145, avgSpeedMps: 2.5, ascentM: 4 }),
    ]);
    expect(a.rpe).toBe(6);
    expect(a.feel).toBe(75);
  });

  it("decodes strength sets, skipping rest sets and 'unknown' categories", () => {
    const a = decodeActivityFile(buildStrength(), "strength_training");
    expect(a.sets).toEqual([
      { idx: 0, exercise: "benchPress", reps: 8, weightKg: 60, durationS: 30 },
      { idx: 1, exercise: "shoulderPress", reps: 10, weightKg: 20, durationS: 25 },
    ]);
    expect(a.streams?.lat.every((v) => v === null)).toBe(true);
    expect(a.rpe).toBeNull();
  });

  it("accepts a bare FIT file and rejects junk", () => {
    expect(fitFromZip(new Uint8Array([1, 2, 3]))).toEqual(new Uint8Array([1, 2, 3]));
    expect(() => decodeActivityFile(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), "running")).toThrow();
  });
});
