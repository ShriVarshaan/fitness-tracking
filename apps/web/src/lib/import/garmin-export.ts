import { num, reading, roundOrNull, within, type ActivityImportRow, type DailyImportRow, type SleepImportRow } from "./rows";

/**
 * Garmin account export ("Export your data" on garmin.com, a ZIP of JSON files
 * under DI_CONNECT/). Garmin documents none of it; these mappers are tolerant
 * and check units from the data itself rather than trusting a guess.
 * The rows are Garmin's own data, so they are stored with source "garmin" and
 * collide with the Personal API's rows on the same keys (activities by
 * activity id, days by date) instead of duplicating them.
 */

export type GarminExportKind = "daily" | "sleep" | "activities";

/** Which export files we read, by path. Everything else in the ZIP is skipped. */
export function garminExportKind(path: string): GarminExportKind | null {
  if (/DI-Connect-Aggregator\/UDSFile_[^/]*\.json$/i.test(path)) return "daily";
  if (/DI-Connect-Wellness\/[^/]*sleepData\.json$/i.test(path)) return "sleep";
  if (/DI-Connect-Fitness\/[^/]*summarizedActivities\.json$/i.test(path)) return "activities";
  return null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** "2023-01-01", "2023-01-01T00:00:00.0" → "2023-01-01"; anything else → null. */
function isoDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v);
  return m ? m[1]! : null;
}

/** Epoch ms, or a Garmin "YYYY-MM-DDTHH:mm:ss.0" / "YYYY-MM-DD HH:mm:ss" string read as UTC. */
function epochMs(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return null;
  const s = v.replace(" ", "T");
  const ms = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`);
  return Number.isNaN(ms) ? null : ms;
}

/** Local minus GMT, in minutes, if it is a real UTC offset. */
function offsetMin(localMs: number | null, gmtMs: number | null): number | null {
  if (localMs === null || gmtMs === null) return null;
  const min = Math.round((localMs - gmtMs) / 60_000);
  return Math.abs(min) <= 14 * 60 ? min : null;
}

export interface MapResult<T> {
  rows: T[];
  skipped: number;
}

// ---------------------------------------------------------------------------------
// Daily summaries: DI-Connect-Aggregator/UDSFile_*.json → [ { calendarDate, totalSteps, … } ]
// ---------------------------------------------------------------------------------

export function mapGarminExportDaily(json: unknown): MapResult<DailyImportRow> {
  if (!Array.isArray(json)) throw new Error("expected a list of daily summaries");
  const rows: DailyImportRow[] = [];
  let skipped = 0;
  for (const d of json) {
    const localDate = isObj(d) ? isoDate(d.calendarDate) : null;
    if (!isObj(d) || !localDate) {
      skipped++;
      continue;
    }
    const stress = (isObj(d.allDayStress) && Array.isArray(d.allDayStress.aggregatorList) ? d.allDayStress.aggregatorList : []).find(
      (a): a is Obj => isObj(a) && a.type === "TOTAL",
    );
    const bb = isObj(d.bodyBattery) && Array.isArray(d.bodyBattery.bodyBatteryStatList) ? d.bodyBattery.bodyBatteryStatList.filter(isObj) : [];
    const bbStat = (type: string) => reading(bb.find((s) => s.bodyBatteryStatType === type)?.statsValue);
    const resp = isObj(d.respiration) ? d.respiration : {};
    const intInRange = (v: number | null, max: number) => roundOrNull(within(v, 0, max));
    rows.push({
      localDate,
      tzOffsetMin: offsetMin(epochMs(d.wellnessStartTimeLocal), epochMs(d.wellnessStartTimeGmt)),
      steps: intInRange(reading(d.totalSteps), 200_000),
      stepsGoal: intInRange(reading(d.dailyStepGoal), 200_000),
      distanceM: within(reading(d.totalDistanceMeters), 0, 500_000),
      floorsAscended: null,
      totalKcal: within(reading(d.totalKilocalories), 0, 20_000),
      activeKcal: within(reading(d.activeKilocalories), 0, 15_000),
      restingKcal: within(reading(d.bmrKilocalories), 0, 10_000),
      intensityMinModerate: intInRange(reading(d.moderateIntensityMinutes), 1_440),
      intensityMinVigorous: intInRange(reading(d.vigorousIntensityMinutes), 1_440),
      restingHr: roundOrNull(within(reading(d.restingHeartRate) ?? reading(d.currentDayRestingHeartRate), 20, 200)),
      minHr: roundOrNull(within(reading(d.minHeartRate), 20, 250)),
      maxHr: roundOrNull(within(reading(d.maxHeartRate), 20, 250)),
      stressAvg: intInRange(reading(stress?.averageStressLevel), 100),
      stressMax: intInRange(reading(stress?.maxStressLevel), 100),
      stressRestS: intInRange(reading(stress?.restDuration), 86_400),
      stressLowS: intInRange(reading(stress?.lowDuration), 86_400),
      stressMediumS: intInRange(reading(stress?.mediumDuration), 86_400),
      stressHighS: intInRange(reading(stress?.highDuration), 86_400),
      bodyBatteryHigh: intInRange(bbStat("HIGHEST"), 100),
      bodyBatteryLow: intInRange(bbStat("LOWEST"), 100),
      respirationAvg: within(reading(resp.avgWakingRespirationValue), 2, 80),
      respirationMin: within(reading(resp.lowestRespirationValue), 2, 80),
      respirationMax: within(reading(resp.highestRespirationValue), 2, 80),
    });
  }
  return { rows, skipped };
}

// ---------------------------------------------------------------------------------
// Sleep: DI-Connect-Wellness/*_sleepData.json → [ { calendarDate, sleepStartTimestampGMT, … } ]
// ---------------------------------------------------------------------------------

/** Export nights get their own record id; a night the API already stored for that date wins. */
export const exportSleepId = (localDate: string) => `export-${localDate}`;

export function mapGarminExportSleep(json: unknown): MapResult<SleepImportRow> {
  if (!Array.isArray(json)) throw new Error("expected a list of nights");
  const rows: SleepImportRow[] = [];
  let skipped = 0;
  for (const s of json) {
    const localDate = isObj(s) ? isoDate(s.calendarDate) : null;
    const start = isObj(s) ? epochMs(s.sleepStartTimestampGMT) : null;
    const end = isObj(s) ? epochMs(s.sleepEndTimestampGMT) : null;
    if (!isObj(s) || !localDate || start === null || end === null || end <= start || end - start > 24 * 3600_000) {
      skipped++;
      continue;
    }
    const secs = (v: unknown) => roundOrNull(within(reading(v), 0, 86_400));
    const deep = secs(s.deepSleepSeconds);
    const light = secs(s.lightSleepSeconds);
    const rem = secs(s.remSleepSeconds);
    const staged = [deep, light, rem].filter((x): x is number => x !== null);
    const scores = isObj(s.sleepScores) ? s.sleepScores : {};
    const overall = reading(scores.overallScore) ?? (isObj(scores.overall) ? reading(scores.overall.value) : null);
    const spo2 = isObj(s.spo2SleepSummary) ? s.spo2SleepSummary : {};
    rows.push({
      sourceRecordId: exportSleepId(localDate),
      localDate,
      startTime: new Date(start).toISOString(),
      endTime: new Date(end).toISOString(),
      tzOffsetMin: offsetMin(epochMs(s.sleepStartTimestampLocal), start),
      totalSleepS: secs(s.sleepTimeSeconds) ?? (staged.length ? staged.reduce((a, b) => a + b, 0) : null),
      deepS: deep,
      lightS: light,
      remS: rem,
      awakeS: secs(s.awakeSleepSeconds),
      awakeCount: roundOrNull(within(reading(s.awakeCount), 0, 500)),
      sourceScore: roundOrNull(within(overall, 0, 100)),
      avgHr: within(reading(spo2.averageHR) ?? reading(s.avgHeartRate), 20, 200),
      avgSpo2: within(reading(spo2.averageSPO2) ?? reading(s.averageSpO2Value), 50, 100),
      lowestSpo2: within(reading(spo2.lowestSPO2) ?? reading(s.lowestSpO2Value), 50, 100),
      avgRespiration: within(reading(s.averageRespiration) ?? reading(s.averageRespirationValue), 2, 80),
      avgSleepStress: within(reading(s.avgSleepStress), 0, 100),
    });
  }
  return { rows, skipped };
}

// ---------------------------------------------------------------------------------
// Activities: DI-Connect-Fitness/*_summarizedActivities.json
//   → [ { summarizedActivitiesExport: [ { activityId, activityType, startTimeGmt, … } ] } ]
// ---------------------------------------------------------------------------------

/**
 * The export stores distance, duration and speed in units that differ from the
 * API (observed in published exports: centimetres, milliseconds and cm/ms).
 * Rather than trust that, detect it: distance ÷ duration must agree with the
 * reported average speed. "cm-ms" when they agree directly, "m-ms" when
 * distance is metres and speed m/s; anything else is refused.
 */
export type ExportUnits = "cm-ms" | "m-ms" | "m-s";

const median = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)]!;

/**
 * cm/ms and m/s give the same distance ÷ time ÷ speed ratio, so durations tell
 * them apart: a typical activity lasts minutes to hours, which is over 60,000
 * in milliseconds and under that in seconds.
 */
export function detectActivityUnits(list: readonly Obj[]): ExportUnits | null {
  const ratios: number[] = [];
  const durations: number[] = [];
  for (const a of list) {
    const d = reading(a.distance);
    const t = reading(a.movingDuration) ?? reading(a.duration);
    const v = reading(a.avgSpeed);
    if (d && t && v) {
      ratios.push(d / t / v);
      durations.push(t);
    }
  }
  if (!ratios.length) return null;
  const ratio = median(ratios);
  const ms = median(durations) > 60_000;
  // Pauses make elapsed speed lower than moving speed, so allow a wide band.
  if (ratio > 0.3 && ratio < 1.5) return ms ? "cm-ms" : "m-s";
  if (ratio > 0.0003 && ratio < 0.0015 && ms) return "m-ms";
  return null;
}

function activityList(json: unknown): Obj[] {
  if (!Array.isArray(json)) throw new Error("expected a list of activities");
  const out: Obj[] = [];
  for (const item of json) {
    if (isObj(item) && Array.isArray(item.summarizedActivitiesExport)) out.push(...item.summarizedActivitiesExport.filter(isObj));
    else if (isObj(item) && "activityId" in item) out.push(item);
  }
  return out;
}

const sportKey = (v: unknown): string =>
  typeof v === "string" && v.trim() ? v.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "other" : isObj(v) && typeof v.typeKey === "string" ? sportKey(v.typeKey) : "other";

export function mapGarminExportActivities(json: unknown): MapResult<ActivityImportRow> & { units: ExportUnits | null } {
  const list = activityList(json);
  const units = detectActivityUnits(list);
  if (list.length && units === null && list.some((a) => reading(a.distance))) {
    throw new Error("activity distances and speeds are in units this importer doesn't recognise");
  }
  const distScale = units === "cm-ms" || units === null ? 0.01 : 1;
  const speedScale = units === "cm-ms" || units === null ? 10 : 1;
  const durScale = units === "m-s" ? 1 : 0.001;
  const rows: ActivityImportRow[] = [];
  let skipped = 0;
  for (const a of list) {
    const id = num(a.activityId);
    const start = epochMs(a.startTimeGmt) ?? epochMs(a.beginTimestamp);
    if (id === null || start === null) {
      skipped++;
      continue;
    }
    const tz = offsetMin(epochMs(a.startTimeLocal), start);
    const durationS = within(reading(a.duration) === null ? null : reading(a.duration)! * durScale, 0, 7 * 86_400);
    const movingS = within(reading(a.movingDuration) === null ? null : reading(a.movingDuration)! * durScale, 0, 7 * 86_400);
    const distanceM = within(reading(a.distance) === null ? null : reading(a.distance)! * distScale, 0, 2_000_000);
    const avgSpeed = distanceM && (movingS || durationS) ? distanceM / (movingS || durationS)! : null;
    const maxSpeed = reading(a.maxSpeed) === null ? null : reading(a.maxSpeed)! * speedScale;
    // Zone times: seconds in the API; if they add up to more than the activity, they are milliseconds.
    const zonesRaw = [1, 2, 3, 4, 5].map((z) => reading(a[`hrTimeInZone_${z}`]));
    const zoneSum = zonesRaw.reduce<number>((s, z) => s + (z ?? 0), 0);
    const zoneScale = durationS && zoneSum > durationS * 1.1 ? 0.001 : 1;
    const zones = zonesRaw.some((z) => z !== null) ? zonesRaw.map((z) => Math.min(7 * 86_400, (z ?? 0) * zoneScale)) : null;
    rows.push({
      sourceRecordId: String(Math.round(id)),
      sport: sportKey(a.activityType ?? a.sportType),
      name: typeof a.name === "string" ? a.name.slice(0, 200) : null,
      startTime: new Date(start).toISOString(),
      tzOffsetMin: tz,
      localDate: new Date(start + (tz ?? 0) * 60_000).toISOString().slice(0, 10),
      durationS,
      movingS,
      distanceM,
      ascentM: within(reading(a.elevationGain) === null ? null : reading(a.elevationGain)! * distScale, 0, 20_000),
      descentM: within(reading(a.elevationLoss) === null ? null : reading(a.elevationLoss)! * distScale, 0, 20_000),
      avgHr: roundOrNull(within(reading(a.avgHr), 20, 250)),
      maxHr: roundOrNull(within(reading(a.maxHr), 20, 250)),
      avgSpeedMps: within(avgSpeed, 0, 100),
      maxSpeedMps: avgSpeed !== null && maxSpeed !== null && maxSpeed >= avgSpeed ? within(maxSpeed, 0, 150) : null,
      avgPowerW: within(reading(a.avgPower), 0, 3_000),
      maxPowerW: within(reading(a.maxPower), 0, 5_000),
      normPowerW: within(reading(a.normPower), 0, 3_000),
      // Cadence and calories use units the export doesn't make checkable (strides vs steps, kJ vs kcal): left out.
      avgCadence: null,
      kcal: null,
      sourceTrainingLoad: within(reading(a.activityTrainingLoad), 0, 2_000),
      aerobicTe: within(reading(a.aerobicTrainingEffect), 0, 5),
      anaerobicTe: within(reading(a.anaerobicTrainingEffect), 0, 5),
      intensityMinModerate: roundOrNull(within(reading(a.moderateIntensityMinutes), 0, 10_080)),
      intensityMinVigorous: roundOrNull(within(reading(a.vigorousIntensityMinutes), 0, 10_080)),
      hrZoneS: zones,
      lapCount: roundOrNull(within(reading(a.lapCount), 0, 10_000)),
    });
  }
  return { rows, skipped, units };
}
