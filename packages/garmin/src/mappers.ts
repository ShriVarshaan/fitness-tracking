import { z } from "zod";

/**
 * Garmin publishes no response schemas. These were written against real
 * responses (Nov 2026) and are deliberately tolerant: every field is optional
 * and unknown fields are ignored. A payload that doesn't even match the outer
 * shape throws, so the sync quarantines it instead of silently dropping data.
 */

const num = z.number().nullish();
const str = z.string().nullish();
const toNull = <T>(v: T | null | undefined): T | null => (v === undefined ? null : v);
const roundOrNull = (v: number | null | undefined) => (typeof v === "number" ? Math.round(v) : null);

/** Garmin's "local" timestamps are wall-clock times written as if UTC; the gap to GMT is the offset. */
export function offsetMinutes(localMs: number, gmtMs: number): number | null {
  const min = Math.round((localMs - gmtMs) / 60_000);
  return Math.abs(min) <= 14 * 60 ? min : null;
}

const garminTs = (s: string) => Date.parse(s.endsWith("Z") ? s : `${s}Z`);

// ---------------------------------------------------------------------------------
// Daily summaries: GET /usersummary-service/v2/dailysummaries → { data: [...] }
// ---------------------------------------------------------------------------------

const movementValue = z.object({ value: num, goal: num, distanceInMeters: num }).partial().nullish();

const dailySummary = z.object({
  uuid: str,
  calendarDate: z.iso.date(),
  wellnessChronology: z.object({ startTimestampGmt: str, startTimestampLocal: str }).partial().nullish(),
  movement: z.object({ steps: movementValue, floorsAscended: movementValue }).partial().nullish(),
  calories: z.object({ burnedTotal: num, burnedActive: num, burnedResting: num }).partial().nullish(),
  intensityMinutes: z.object({ moderate: num, vigorous: num, goal: num }).partial().nullish(),
  heartRate: z.object({ restingValue: num, minValue: num, maxValue: num }).partial().nullish(),
  stress: z
    .object({
      avgLevel: num,
      maxLevel: num,
      restDurationInMillis: num,
      lowStressDurationInMillis: num,
      mediumStressDurationInMillis: num,
      highStressDurationInMillis: num,
    })
    .partial()
    .nullish(),
  bodyBattery: z.object({ maxValue: num, minValue: num, chargedValue: num, drainedValue: num }).partial().nullish(),
  pulseOx: z.object({ avgValue: num, minValue: num }).partial().nullish(),
  respiration: z.object({ avgValue: num, minValue: num, maxValue: num }).partial().nullish(),
});

export const dailySummariesResponse = z.object({ data: z.array(dailySummary) });

export interface DailySummaryRow {
  localDate: string;
  tzOffsetMin: number | null;
  sourceRecordId: string | null;
  steps: number | null;
  stepsGoal: number | null;
  distanceM: number | null;
  floorsAscended: number | null;
  totalKcal: number | null;
  activeKcal: number | null;
  restingKcal: number | null;
  intensityMinModerate: number | null;
  intensityMinVigorous: number | null;
  intensityMinGoal: number | null;
  restingHr: number | null;
  minHr: number | null;
  maxHr: number | null;
  stressAvg: number | null;
  stressMax: number | null;
  stressRestS: number | null;
  stressLowS: number | null;
  stressMediumS: number | null;
  stressHighS: number | null;
  bodyBatteryHigh: number | null;
  bodyBatteryLow: number | null;
  bodyBatteryCharged: number | null;
  bodyBatteryDrained: number | null;
  spo2Avg: number | null;
  spo2Min: number | null;
  respirationAvg: number | null;
  respirationMin: number | null;
  respirationMax: number | null;
}

/** Garmin uses negative numbers (e.g. -1, -2) for "no reading". */
const reading = (v: number | null | undefined) => (typeof v === "number" && v >= 0 ? v : null);
const msToS = (v: number | null | undefined) => (typeof v === "number" && v >= 0 ? Math.round(v / 1000) : null);

export function mapDailySummaries(payload: unknown): DailySummaryRow[] {
  const { data } = dailySummariesResponse.parse(payload);
  return data.map((d) => {
    const chrono = d.wellnessChronology;
    const tz =
      chrono?.startTimestampLocal && chrono.startTimestampGmt
        ? offsetMinutes(garminTs(chrono.startTimestampLocal), garminTs(chrono.startTimestampGmt))
        : null;
    return {
      localDate: d.calendarDate,
      tzOffsetMin: tz,
      sourceRecordId: toNull(d.uuid),
      steps: roundOrNull(reading(d.movement?.steps?.value)),
      stepsGoal: roundOrNull(reading(d.movement?.steps?.goal)),
      distanceM: reading(d.movement?.steps?.distanceInMeters),
      floorsAscended: reading(d.movement?.floorsAscended?.value),
      totalKcal: reading(d.calories?.burnedTotal),
      activeKcal: reading(d.calories?.burnedActive),
      restingKcal: reading(d.calories?.burnedResting),
      intensityMinModerate: roundOrNull(reading(d.intensityMinutes?.moderate)),
      intensityMinVigorous: roundOrNull(reading(d.intensityMinutes?.vigorous)),
      intensityMinGoal: roundOrNull(reading(d.intensityMinutes?.goal)),
      restingHr: roundOrNull(reading(d.heartRate?.restingValue)),
      minHr: roundOrNull(reading(d.heartRate?.minValue)),
      maxHr: roundOrNull(reading(d.heartRate?.maxValue)),
      stressAvg: roundOrNull(reading(d.stress?.avgLevel)),
      stressMax: roundOrNull(reading(d.stress?.maxLevel)),
      stressRestS: msToS(d.stress?.restDurationInMillis),
      stressLowS: msToS(d.stress?.lowStressDurationInMillis),
      stressMediumS: msToS(d.stress?.mediumStressDurationInMillis),
      stressHighS: msToS(d.stress?.highStressDurationInMillis),
      bodyBatteryHigh: roundOrNull(reading(d.bodyBattery?.maxValue)),
      bodyBatteryLow: roundOrNull(reading(d.bodyBattery?.minValue)),
      bodyBatteryCharged: roundOrNull(reading(d.bodyBattery?.chargedValue)),
      bodyBatteryDrained: roundOrNull(reading(d.bodyBattery?.drainedValue)),
      spo2Avg: reading(d.pulseOx?.avgValue),
      spo2Min: reading(d.pulseOx?.minValue),
      respirationAvg: reading(d.respiration?.avgValue),
      respirationMin: reading(d.respiration?.minValue),
      respirationMax: reading(d.respiration?.maxValue),
    };
  });
}

// ---------------------------------------------------------------------------------
// Sleep: GET /sleep-service/sleep/dailySleepSummariesByDate → [...]
// ---------------------------------------------------------------------------------

const sleepSummary = z.object({
  // Days with no recorded night come back with id and calendarDate null.
  id: z.union([z.number(), z.string()]).nullish(),
  calendarDate: z.iso.date().nullish(),
  sleepStartTimestampGMT: num,
  sleepEndTimestampGMT: num,
  sleepStartTimestampLocal: num,
  sleepTimeSeconds: num,
  deepSleepSeconds: num,
  lightSleepSeconds: num,
  remSleepSeconds: num,
  awakeSleepSeconds: num,
  unmeasurableSleepSeconds: num,
  napTimeSeconds: num,
  awakeCount: num,
  avgHeartRate: num,
  averageSpO2Value: num,
  lowestSpO2Value: num,
  averageRespirationValue: num,
  avgSleepStress: num,
  sleepScores: z.object({ overall: z.object({ value: num, qualifierKey: str }).partial().nullish() }).partial().nullish(),
  sleepNeed: z.object({ actual: num }).partial().nullish(),
});

export const sleepSummariesResponse = z.array(sleepSummary);

export interface SleepRow {
  sourceRecordId: string;
  localDate: string;
  startTime: Date;
  endTime: Date;
  tzOffsetMin: number | null;
  totalSleepS: number | null;
  deepS: number | null;
  lightS: number | null;
  remS: number | null;
  awakeS: number | null;
  unmeasurableS: number | null;
  napS: number | null;
  awakeCount: number | null;
  sourceScore: number | null;
  sourceScoreQualifier: string | null;
  sleepNeedMin: number | null;
  avgHr: number | null;
  avgSpo2: number | null;
  lowestSpo2: number | null;
  avgRespiration: number | null;
  avgSleepStress: number | null;
}

export function mapSleepSummaries(payload: unknown): SleepRow[] {
  const rows: SleepRow[] = [];
  for (const s of sleepSummariesResponse.parse(payload ?? [])) {
    // Days without a recorded night come back with no start/end: nothing to store.
    if (
      s.id == null ||
      !s.calendarDate ||
      typeof s.sleepStartTimestampGMT !== "number" ||
      typeof s.sleepEndTimestampGMT !== "number"
    ) {
      continue;
    }
    rows.push({
      sourceRecordId: String(s.id),
      // Garmin dates a night to the morning you wake, matching our rule.
      localDate: s.calendarDate,
      startTime: new Date(s.sleepStartTimestampGMT),
      endTime: new Date(s.sleepEndTimestampGMT),
      tzOffsetMin:
        typeof s.sleepStartTimestampLocal === "number"
          ? offsetMinutes(s.sleepStartTimestampLocal, s.sleepStartTimestampGMT)
          : null,
      totalSleepS: roundOrNull(reading(s.sleepTimeSeconds)),
      deepS: roundOrNull(reading(s.deepSleepSeconds)),
      lightS: roundOrNull(reading(s.lightSleepSeconds)),
      remS: roundOrNull(reading(s.remSleepSeconds)),
      awakeS: roundOrNull(reading(s.awakeSleepSeconds)),
      unmeasurableS: roundOrNull(reading(s.unmeasurableSleepSeconds)),
      napS: roundOrNull(reading(s.napTimeSeconds)),
      awakeCount: roundOrNull(reading(s.awakeCount)),
      sourceScore: roundOrNull(reading(s.sleepScores?.overall?.value)),
      sourceScoreQualifier: toNull(s.sleepScores?.overall?.qualifierKey),
      sleepNeedMin: roundOrNull(reading(s.sleepNeed?.actual)),
      avgHr: reading(s.avgHeartRate),
      avgSpo2: reading(s.averageSpO2Value),
      lowestSpo2: reading(s.lowestSpO2Value),
      avgRespiration: reading(s.averageRespirationValue),
      avgSleepStress: reading(s.avgSleepStress),
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------------
// HRV: GET /hrv-service/hrv/daily/{start}/{end} → { hrvSummaries: [...] }
// ---------------------------------------------------------------------------------

const hrvSummary = z.object({
  calendarDate: z.iso.date(),
  lastNightAvg: num,
  lastNight5MinHigh: num,
  weeklyAvg: num,
  status: str,
  baseline: z.object({ lowUpper: num, balancedLow: num, balancedUpper: num }).partial().nullish(),
});

export const hrvResponse = z.object({ hrvSummaries: z.array(hrvSummary).nullish() });

export interface HrvRow {
  localDate: string;
  lastNightAvgMs: number | null;
  lastNight5MinHighMs: number | null;
  weeklyAvgMs: number | null;
  baselineLowUpperMs: number | null;
  baselineBalancedLowMs: number | null;
  baselineBalancedUpperMs: number | null;
  sourceStatus: string | null;
}

export function mapHrv(payload: unknown): HrvRow[] {
  if (payload === null) return [];
  const { hrvSummaries } = hrvResponse.parse(payload);
  return (hrvSummaries ?? [])
    .filter((h) => reading(h.lastNightAvg) !== null || reading(h.weeklyAvg) !== null)
    .map((h) => ({
      localDate: h.calendarDate,
      lastNightAvgMs: reading(h.lastNightAvg),
      lastNight5MinHighMs: reading(h.lastNight5MinHigh),
      weeklyAvgMs: reading(h.weeklyAvg),
      baselineLowUpperMs: reading(h.baseline?.lowUpper),
      baselineBalancedLowMs: reading(h.baseline?.balancedLow),
      baselineBalancedUpperMs: reading(h.baseline?.balancedUpper),
      sourceStatus: toNull(h.status),
    }));
}

// ---------------------------------------------------------------------------------
// Activities: GET /activitylist-service/activities/search/activities → [...]
// ---------------------------------------------------------------------------------

const activitySummary = z.object({
  activityId: z.union([z.number(), z.string()]),
  activityName: str,
  activityType: z.object({ typeKey: str }).partial().nullish(),
  startTimeGMT: z.string(), // "YYYY-MM-DD HH:mm:ss", UTC
  startTimeLocal: str,
  duration: num,
  movingDuration: num,
  distance: num,
  elevationGain: num,
  elevationLoss: num,
  averageHR: num,
  maxHR: num,
  averageSpeed: num,
  maxSpeed: num,
  avgPower: num,
  maxPower: num,
  normPower: num,
  averageRunningCadenceInStepsPerMinute: num,
  averageBikingCadenceInRevPerMinute: num,
  calories: num,
  activityTrainingLoad: num,
  aerobicTrainingEffect: num,
  anaerobicTrainingEffect: num,
  trainingEffectLabel: str,
  moderateIntensityMinutes: num,
  vigorousIntensityMinutes: num,
  hrTimeInZone_1: num,
  hrTimeInZone_2: num,
  hrTimeInZone_3: num,
  hrTimeInZone_4: num,
  hrTimeInZone_5: num,
  lapCount: num,
  startLatitude: num,
});

export const activitiesResponse = z.array(activitySummary);

export interface ActivityRow {
  sourceRecordId: string;
  sport: string;
  name: string | null;
  startTime: Date;
  tzOffsetMin: number | null;
  localDate: string;
  durationS: number | null;
  movingS: number | null;
  distanceM: number | null;
  ascentM: number | null;
  descentM: number | null;
  avgHr: number | null;
  maxHr: number | null;
  avgSpeedMps: number | null;
  maxSpeedMps: number | null;
  avgPowerW: number | null;
  maxPowerW: number | null;
  normPowerW: number | null;
  avgCadence: number | null;
  kcal: number | null;
  sourceTrainingLoad: number | null;
  aerobicTe: number | null;
  anaerobicTe: number | null;
  trainingEffectLabel: string | null;
  intensityMinModerate: number | null;
  intensityMinVigorous: number | null;
  hrZoneS: number[] | null;
  lapCount: number | null;
  hasRoute: boolean;
}

const garminSpaceTs = (s: string) => garminTs(s.replace(" ", "T"));

export function mapActivities(payload: unknown): ActivityRow[] {
  return activitiesResponse.parse(payload ?? []).map((a) => {
    const startMs = garminSpaceTs(a.startTimeGMT);
    if (Number.isNaN(startMs)) throw new Error(`activity ${a.activityId}: bad startTimeGMT`);
    const tz = a.startTimeLocal ? offsetMinutes(garminSpaceTs(a.startTimeLocal), startMs) : null;
    const zones = [a.hrTimeInZone_1, a.hrTimeInZone_2, a.hrTimeInZone_3, a.hrTimeInZone_4, a.hrTimeInZone_5];
    return {
      sourceRecordId: String(a.activityId),
      sport: a.activityType?.typeKey ?? "other",
      name: toNull(a.activityName),
      startTime: new Date(startMs),
      tzOffsetMin: tz,
      // Dated by the activity's own offset, so a late run abroad lands on the right day.
      localDate: new Date(startMs + (tz ?? 0) * 60_000).toISOString().slice(0, 10),
      durationS: reading(a.duration),
      movingS: reading(a.movingDuration),
      distanceM: reading(a.distance),
      ascentM: reading(a.elevationGain),
      descentM: reading(a.elevationLoss),
      avgHr: roundOrNull(reading(a.averageHR)),
      maxHr: roundOrNull(reading(a.maxHR)),
      avgSpeedMps: reading(a.averageSpeed),
      maxSpeedMps: reading(a.maxSpeed),
      avgPowerW: reading(a.avgPower),
      maxPowerW: reading(a.maxPower),
      normPowerW: reading(a.normPower),
      avgCadence: reading(a.averageRunningCadenceInStepsPerMinute) ?? reading(a.averageBikingCadenceInRevPerMinute),
      kcal: reading(a.calories),
      sourceTrainingLoad: reading(a.activityTrainingLoad),
      aerobicTe: reading(a.aerobicTrainingEffect),
      anaerobicTe: reading(a.anaerobicTrainingEffect),
      trainingEffectLabel: toNull(a.trainingEffectLabel),
      intensityMinModerate: roundOrNull(reading(a.moderateIntensityMinutes)),
      intensityMinVigorous: roundOrNull(reading(a.vigorousIntensityMinutes)),
      hrZoneS: zones.some((z) => typeof z === "number") ? zones.map((z) => reading(z) ?? 0) : null,
      lapCount: roundOrNull(reading(a.lapCount)),
      hasRoute: typeof a.startLatitude === "number",
    };
  });
}

// ---------------------------------------------------------------------------------
// VO2 max: GET /metrics-service/metrics/maxmet/daily/{start}/{end} → [{ generic, cycling }]
// ---------------------------------------------------------------------------------

const vo2Entry = z.object({ calendarDate: z.iso.date(), vo2MaxPreciseValue: num, vo2MaxValue: num }).partial().nullish();
export const vo2maxResponse = z.array(z.object({ generic: vo2Entry, cycling: vo2Entry }));

export interface Vo2maxRow {
  localDate: string;
  sport: "running" | "cycling";
  value: number;
}

export function mapVo2max(payload: unknown): Vo2maxRow[] {
  const rows: Vo2maxRow[] = [];
  for (const day of vo2maxResponse.parse(payload ?? [])) {
    const entries = [
      ["running", day.generic],
      ["cycling", day.cycling],
    ] as const;
    for (const [sport, entry] of entries) {
      const value = reading(entry?.vo2MaxPreciseValue) ?? reading(entry?.vo2MaxValue);
      if (entry?.calendarDate && value !== null) rows.push({ localDate: entry.calendarDate, sport, value });
    }
  }
  return rows;
}

/** True for the "nothing here" responses Garmin returns for empty ranges. */
export function isEmptyPayload(payload: unknown): boolean {
  if (payload === null || payload === undefined) return true;
  if (Array.isArray(payload)) return payload.length === 0;
  if (typeof payload === "object") {
    const p = payload as Record<string, unknown>;
    if (Array.isArray(p.dailyWeightSummaries)) return p.dailyWeightSummaries.length === 0;
  }
  return false;
}
