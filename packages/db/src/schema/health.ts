import {
  bigint,
  boolean,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { ownerReadPolicy, userId } from "./_shared";

/** Provenance columns on every source-derived row (docs/PLAN.md §5). */
const provenance = () => ({
  source: text("source").notNull().default("garmin"),
  sourceRecordId: text("source_record_id"),
  rawIngestId: bigint("raw_ingest_id", { mode: "number" }),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One row per user, day and source. Garmin revises a day's summary as the day
 * goes on, so rows are upserted. Only the server writes these tables.
 */
export const dailySummaries = pgTable(
  "daily_summaries",
  {
    userId: userId(),
    localDate: date("local_date").notNull(),
    tzOffsetMin: smallint("tz_offset_min"),
    steps: integer("steps"),
    stepsGoal: integer("steps_goal"),
    distanceM: real("distance_m"),
    floorsAscended: real("floors_ascended"),
    totalKcal: real("total_kcal"),
    activeKcal: real("active_kcal"),
    restingKcal: real("resting_kcal"),
    intensityMinModerate: smallint("intensity_min_moderate"),
    intensityMinVigorous: smallint("intensity_min_vigorous"),
    intensityMinGoal: smallint("intensity_min_goal"),
    restingHr: smallint("resting_hr"),
    minHr: smallint("min_hr"),
    maxHr: smallint("max_hr"),
    stressAvg: smallint("stress_avg"),
    stressMax: smallint("stress_max"),
    stressRestS: integer("stress_rest_s"),
    stressLowS: integer("stress_low_s"),
    stressMediumS: integer("stress_medium_s"),
    stressHighS: integer("stress_high_s"),
    bodyBatteryHigh: smallint("body_battery_high"),
    bodyBatteryLow: smallint("body_battery_low"),
    bodyBatteryCharged: smallint("body_battery_charged"),
    bodyBatteryDrained: smallint("body_battery_drained"),
    spo2Avg: real("spo2_avg"),
    spo2Min: real("spo2_min"),
    respirationAvg: real("respiration_avg"),
    respirationMin: real("respiration_min"),
    respirationMax: real("respiration_max"),
    ...provenance(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.localDate, t.source] }),
    ownerReadPolicy("daily_summaries"),
  ],
).enableRLS();

/** A night's sleep, dated to the local morning of waking. */
export const sleepSessions = pgTable(
  "sleep_sessions",
  {
    userId: userId(),
    localDate: date("local_date").notNull(),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    tzOffsetMin: smallint("tz_offset_min"),
    totalSleepS: integer("total_sleep_s"),
    deepS: integer("deep_s"),
    lightS: integer("light_s"),
    remS: integer("rem_s"),
    awakeS: integer("awake_s"),
    unmeasurableS: integer("unmeasurable_s"),
    napS: integer("nap_s"),
    awakeCount: smallint("awake_count"),
    /** Garmin's own sleep score (shown as Garmin's, never recomputed). */
    sourceScore: smallint("source_score"),
    sourceScoreQualifier: text("source_score_qualifier"),
    sleepNeedMin: smallint("sleep_need_min"),
    avgHr: real("avg_hr"),
    avgSpo2: real("avg_spo2"),
    lowestSpo2: real("lowest_spo2"),
    avgRespiration: real("avg_respiration"),
    avgSleepStress: real("avg_sleep_stress"),
    ...provenance(),
  },
  (t) => [
    uniqueIndex("sleep_sessions_source_uq").on(t.userId, t.source, t.sourceRecordId),
    index("sleep_sessions_user_date_idx").on(t.userId, t.localDate),
    ownerReadPolicy("sleep_sessions"),
  ],
).enableRLS();

/** Garmin's overnight HRV summary (RMSSD, milliseconds). */
export const hrvDaily = pgTable(
  "hrv_daily",
  {
    userId: userId(),
    localDate: date("local_date").notNull(),
    lastNightAvgMs: real("last_night_avg_ms"),
    lastNight5MinHighMs: real("last_night_5min_high_ms"),
    weeklyAvgMs: real("weekly_avg_ms"),
    /** Garmin's personal baseline band and status, shown as Garmin's. */
    baselineLowUpperMs: real("baseline_low_upper_ms"),
    baselineBalancedLowMs: real("baseline_balanced_low_ms"),
    baselineBalancedUpperMs: real("baseline_balanced_upper_ms"),
    sourceStatus: text("source_status"),
    ...provenance(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.localDate, t.source] }), ownerReadPolicy("hrv_daily")],
).enableRLS();

/** One row per recorded activity (summary level; streams and laps come from FIT files later). */
export const activities = pgTable(
  "activities",
  {
    userId: userId(),
    sport: text("sport").notNull(),
    name: text("name"),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    tzOffsetMin: smallint("tz_offset_min"),
    localDate: date("local_date").notNull(),
    durationS: real("duration_s"),
    movingS: real("moving_s"),
    distanceM: real("distance_m"),
    ascentM: real("ascent_m"),
    descentM: real("descent_m"),
    avgHr: smallint("avg_hr"),
    maxHr: smallint("max_hr"),
    avgSpeedMps: real("avg_speed_mps"),
    maxSpeedMps: real("max_speed_mps"),
    avgPowerW: real("avg_power_w"),
    maxPowerW: real("max_power_w"),
    normPowerW: real("norm_power_w"),
    avgCadence: real("avg_cadence"),
    kcal: real("kcal"),
    /** Garmin's own load and training effect, shown as Garmin's. */
    sourceTrainingLoad: real("source_training_load"),
    aerobicTe: real("aerobic_te"),
    anaerobicTe: real("anaerobic_te"),
    trainingEffectLabel: text("training_effect_label"),
    intensityMinModerate: smallint("intensity_min_moderate"),
    intensityMinVigorous: smallint("intensity_min_vigorous"),
    /** Seconds in Garmin HR zones 1–5. */
    hrZoneS: real("hr_zone_s").array(),
    lapCount: smallint("lap_count"),
    hasRoute: boolean("has_route").notNull().default(false),
    ...provenance(),
  },
  (t) => [
    uniqueIndex("activities_source_uq").on(t.userId, t.source, t.sourceRecordId),
    index("activities_user_start_idx").on(t.userId, t.startTime),
    ownerReadPolicy("activities"),
  ],
).enableRLS();

/** Garmin's VO2 max estimate per day and sport, shown as Garmin's. */
export const vo2maxDaily = pgTable(
  "vo2max_daily",
  {
    userId: userId(),
    localDate: date("local_date").notNull(),
    sport: text("sport", { enum: ["running", "cycling"] }).notNull(),
    value: real("value").notNull(),
    ...provenance(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.localDate, t.sport, t.source] }), ownerReadPolicy("vo2max_daily")],
).enableRLS();
