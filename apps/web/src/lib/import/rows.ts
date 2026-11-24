import { z } from "zod";

/**
 * Canonical rows produced in the browser from an export file and sent to the
 * server in batches. The server parses every batch with these schemas again
 * (never trusting the client); ranges reject impossible values. Units are
 * canonical (docs/PLAN.md §5): s, m, m/s, kg, kcal, bpm, W, % as 0–100.
 */

const n = (min: number, max: number) => z.number().min(min).max(max).nullable().default(null);
const int = (min: number, max: number) => z.number().int().min(min).max(max).nullable().default(null);
const date = z.iso.date();
const instant = z.iso.datetime({ offset: true });
const tz = int(-14 * 60, 14 * 60);
const id = z.string().min(1).max(100);

export const IMPORT_SOURCES = ["garmin_export", "apple_health"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export const dailyRow = z.object({
  localDate: date,
  tzOffsetMin: tz,
  steps: int(0, 200_000),
  stepsGoal: int(0, 200_000),
  distanceM: n(0, 500_000),
  floorsAscended: n(0, 2_000),
  totalKcal: n(0, 20_000),
  activeKcal: n(0, 15_000),
  restingKcal: n(0, 10_000),
  intensityMinModerate: int(0, 1_440),
  intensityMinVigorous: int(0, 1_440),
  restingHr: int(20, 200),
  minHr: int(20, 250),
  maxHr: int(20, 250),
  stressAvg: int(0, 100),
  stressMax: int(0, 100),
  stressRestS: int(0, 86_400),
  stressLowS: int(0, 86_400),
  stressMediumS: int(0, 86_400),
  stressHighS: int(0, 86_400),
  bodyBatteryHigh: int(0, 100),
  bodyBatteryLow: int(0, 100),
  respirationAvg: n(2, 80),
  respirationMin: n(2, 80),
  respirationMax: n(2, 80),
});
export type DailyImportRow = z.input<typeof dailyRow>;

export const sleepRow = z
  .object({
    sourceRecordId: id,
    localDate: date,
    startTime: instant,
    endTime: instant,
    tzOffsetMin: tz,
    totalSleepS: int(0, 86_400),
    deepS: int(0, 86_400),
    lightS: int(0, 86_400),
    remS: int(0, 86_400),
    awakeS: int(0, 86_400),
    awakeCount: int(0, 500),
    sourceScore: int(0, 100),
    avgHr: n(20, 200),
    avgSpo2: n(50, 100),
    lowestSpo2: n(50, 100),
    avgRespiration: n(2, 80),
    avgSleepStress: n(0, 100),
  })
  .refine((s) => Date.parse(s.endTime) > Date.parse(s.startTime) && Date.parse(s.endTime) - Date.parse(s.startTime) <= 24 * 3600_000, {
    message: "sleep must end after it starts, within 24 hours",
  });
export type SleepImportRow = z.input<typeof sleepRow>;

/** Stage intervals inside a night (Apple Health), kept for the Sleep Regularity Index. */
export const SLEEP_STAGES = ["deep", "light", "rem", "awake", "asleep"] as const;
export const stageInterval = z.object({
  start: instant,
  end: instant,
  stage: z.enum(SLEEP_STAGES),
});
export type StageInterval = z.infer<typeof stageInterval>;
export const stageRow = stageInterval.extend({ localDate: date }).refine((s) => Date.parse(s.end) > Date.parse(s.start), { message: "a stage must end after it starts" });
export type StageImportRow = z.input<typeof stageRow>;
/** Stage rows per call: whole nights are kept together (about 100 bytes each). */
export const STAGE_BATCH_SIZE = 1500;

export const activityRow = z.object({
  sourceRecordId: id,
  sport: z.string().min(1).max(60).regex(/^[a-z0-9_]+$/),
  name: z.string().max(200).nullable().default(null),
  startTime: instant,
  tzOffsetMin: tz,
  localDate: date,
  durationS: n(0, 7 * 86_400),
  movingS: n(0, 7 * 86_400),
  distanceM: n(0, 2_000_000),
  ascentM: n(0, 20_000),
  descentM: n(0, 20_000),
  avgHr: int(20, 250),
  maxHr: int(20, 250),
  avgSpeedMps: n(0, 100),
  maxSpeedMps: n(0, 150),
  avgPowerW: n(0, 3_000),
  maxPowerW: n(0, 5_000),
  normPowerW: n(0, 3_000),
  avgCadence: n(0, 300),
  kcal: n(0, 20_000),
  sourceTrainingLoad: n(0, 2_000),
  aerobicTe: n(0, 5),
  anaerobicTe: n(0, 5),
  intensityMinModerate: int(0, 10_080),
  intensityMinVigorous: int(0, 10_080),
  hrZoneS: z.array(z.number().min(0).max(7 * 86_400)).length(5).nullable().default(null),
  lapCount: int(0, 10_000),
});
export type ActivityImportRow = z.input<typeof activityRow>;

export const weightRow = z.object({
  localDate: date,
  weightKg: z.number().min(20).max(400),
  bodyFatPct: n(2, 75),
});
export type WeightImportRow = z.input<typeof weightRow>;

export const vo2Row = z.object({
  localDate: date,
  sport: z.enum(["running", "cycling"]),
  value: z.number().min(10).max(100),
});
export type Vo2ImportRow = z.input<typeof vo2Row>;

/** Rows per server call; keeps each request well under the 1 MB action body limit. */
export const BATCH_SIZE = 250;

export const importBatch = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("daily"), rows: z.array(dailyRow).max(BATCH_SIZE) }),
  z.object({ kind: z.literal("sleep"), rows: z.array(sleepRow).max(BATCH_SIZE) }),
  z.object({ kind: z.literal("activities"), rows: z.array(activityRow).max(BATCH_SIZE) }),
  z.object({ kind: z.literal("sleep_stages"), rows: z.array(stageRow).max(STAGE_BATCH_SIZE) }),
  z.object({ kind: z.literal("weight"), rows: z.array(weightRow).max(BATCH_SIZE) }),
  z.object({ kind: z.literal("vo2max"), rows: z.array(vo2Row).max(BATCH_SIZE) }),
]);
export type ImportBatch = z.input<typeof importBatch>;
export type ImportKind = ImportBatch["kind"];

/** Pull a number out of an unknown value, or null. */
export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
/** Garmin uses negative numbers for "no reading". */
export const reading = (v: unknown): number | null => {
  const x = num(v);
  return x !== null && x >= 0 ? x : null;
};
export const roundOrNull = (v: number | null) => (v === null ? null : Math.round(v));
/** Keep a value only if it lies in [min, max]. */
export const within = (v: number | null, min: number, max: number) => (v !== null && v >= min && v <= max ? v : null);
