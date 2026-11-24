import { describe, expect, it } from "vitest";
import {
  isEmptyPayload,
  mapWeight,
  mapSleepLevels,
  mapActivities,
  mapDailySummaries,
  mapHrv,
  mapSleepSummaries,
  mapVo2max,
  offsetMinutes,
} from "./mappers";

// Fixtures follow the shape of real Garmin responses; every value is made up.

const daily = (over: Record<string, unknown> = {}) => ({
  uuid: "00000000-0000-4000-8000-000000000001",
  calendarDate: "2026-07-10",
  source: "garmin",
  wellnessChronology: {
    startTimestampGmt: "2026-07-09T23:00:00.0",
    startTimestampLocal: "2026-07-10T00:00:00.0",
  },
  movement: {
    steps: { value: 9123, goal: 8000, distanceInMeters: 7012.5 },
    floorsAscended: { value: 6.2, distanceInMeters: 18.9 },
    pushes: {},
  },
  calories: { burnedTotal: 2500, burnedActive: 520, burnedResting: 1980 },
  intensityMinutes: { goal: 150, moderate: 12, vigorous: 4 },
  heartRate: { minValue: 44, maxValue: 150, restingValue: 50 },
  stress: {
    avgLevel: 30,
    maxLevel: 90,
    restDurationInMillis: 30_000_000,
    lowStressDurationInMillis: 10_000_000,
    mediumStressDurationInMillis: 5_000_000,
    highStressDurationInMillis: 2_000_000,
  },
  bodyBattery: { maxValue: 80, minValue: 10, chargedValue: 60, drainedValue: 65 },
  pulseOx: { avgValue: 96, minValue: 88 },
  respiration: { avgValue: 14, minValue: 9, maxValue: 21 },
  jetLag: {},
  hydration: {},
  ...over,
});

describe("offsetMinutes", () => {
  it("reads the wall-clock minus GMT gap", () => {
    expect(offsetMinutes(Date.UTC(2026, 0, 1, 5, 30), Date.UTC(2026, 0, 1, 0, 0))).toBe(330);
  });

  it("rejects impossible offsets", () => {
    expect(offsetMinutes(Date.UTC(2026, 0, 2), Date.UTC(2026, 0, 1))).toBeNull();
  });
});

describe("mapDailySummaries", () => {
  it("maps a full day into canonical units", () => {
    const [row] = mapDailySummaries({ data: [daily()] });
    expect(row).toMatchObject({
      localDate: "2026-07-10",
      tzOffsetMin: 60,
      steps: 9123,
      distanceM: 7012.5,
      restingHr: 50,
      stressAvg: 30,
      stressRestS: 30_000,
      bodyBatteryHigh: 80,
      spo2Avg: 96,
      intensityMinVigorous: 4,
    });
  });

  it("works out the offset while travelling (UTC+5:30)", () => {
    const [row] = mapDailySummaries({
      data: [
        daily({
          wellnessChronology: { startTimestampGmt: "2026-07-09T18:30:00.0", startTimestampLocal: "2026-07-10T00:00:00.0" },
        }),
      ],
    });
    expect(row?.tzOffsetMin).toBe(330);
  });

  it("treats Garmin's negative 'no reading' values and missing sections as null", () => {
    const [row] = mapDailySummaries({
      data: [daily({ heartRate: { restingValue: -1 }, pulseOx: undefined, stress: { avgLevel: -2 } })],
    });
    expect(row?.restingHr).toBeNull();
    expect(row?.spo2Avg).toBeNull();
    expect(row?.stressAvg).toBeNull();
  });

  it("rejects a payload that isn't a daily-summaries response", () => {
    expect(() => mapDailySummaries([{ calendarDate: "2026-07-10" }])).toThrow();
  });
});

describe("mapSleepSummaries", () => {
  const night = {
    id: 1_780_000_000_000,
    calendarDate: "2026-07-11",
    sleepStartTimestampGMT: Date.UTC(2026, 6, 10, 22, 0),
    sleepEndTimestampGMT: Date.UTC(2026, 6, 11, 5, 30),
    sleepStartTimestampLocal: Date.UTC(2026, 6, 10, 23, 0),
    sleepTimeSeconds: 25_000,
    deepSleepSeconds: 5_000,
    lightSleepSeconds: 14_000,
    remSleepSeconds: 6_000,
    awakeSleepSeconds: 2_000,
    unmeasurableSleepSeconds: 0,
    napTimeSeconds: 0,
    awakeCount: 1,
    avgHeartRate: 52,
    averageSpO2Value: 96,
    lowestSpO2Value: 90,
    averageRespirationValue: 13,
    avgSleepStress: 12,
    sleepScores: { overall: { value: 81, qualifierKey: "GOOD" } },
    sleepNeed: { actual: 480 },
  };

  it("maps a night, dated to the wake-up morning", () => {
    const [row] = mapSleepSummaries([night]);
    expect(row).toMatchObject({
      sourceRecordId: "1780000000000",
      localDate: "2026-07-11",
      tzOffsetMin: 60,
      totalSleepS: 25_000,
      sourceScore: 81,
      sourceScoreQualifier: "GOOD",
      sleepNeedMin: 480,
    });
    expect(row?.endTime.toISOString()).toBe("2026-07-11T05:30:00.000Z");
  });

  it("skips days with no recorded night", () => {
    expect(mapSleepSummaries([{ id: 1, calendarDate: "2026-07-12" }])).toEqual([]);
  });

  it("skips Garmin's empty placeholder nights (id and date null)", () => {
    expect(mapSleepSummaries([night, { id: null, calendarDate: null, sleepTimeSeconds: null }])).toHaveLength(1);
  });
});

describe("mapHrv", () => {
  it("maps Garmin's overnight HRV and baseline", () => {
    const rows = mapHrv({
      userProfilePk: 1,
      hrvSummaries: [
        {
          calendarDate: "2026-07-11",
          status: "BALANCED",
          lastNightAvg: 70,
          lastNight5MinHigh: 95,
          weeklyAvg: 68,
          baseline: { lowUpper: 55, balancedLow: 60, balancedUpper: 80, markerValue: 0.4 },
        },
        { calendarDate: "2026-07-12", status: "NONE" },
      ],
    });
    expect(rows).toEqual([
      {
        localDate: "2026-07-11",
        lastNightAvgMs: 70,
        lastNight5MinHighMs: 95,
        weeklyAvgMs: 68,
        baselineLowUpperMs: 55,
        baselineBalancedLowMs: 60,
        baselineBalancedUpperMs: 80,
        sourceStatus: "BALANCED",
      },
    ]);
  });

  it("returns nothing for an empty body", () => {
    expect(mapHrv(null)).toEqual([]);
  });
});

describe("mapActivities", () => {
  const run = {
    activityId: 1000000001,
    activityName: "Evening Run",
    activityType: { typeId: 1, typeKey: "running", parentTypeId: 17 },
    startTimeGMT: "2026-04-09 21:30:00",
    startTimeLocal: "2026-04-09 22:30:00",
    duration: 1800.5,
    movingDuration: 1790,
    distance: 5000.25,
    elevationGain: 12,
    elevationLoss: 10,
    averageHR: 150.4,
    maxHR: 172,
    averageSpeed: 2.78,
    maxSpeed: 3.4,
    avgPower: 250,
    normPower: 255,
    averageRunningCadenceInStepsPerMinute: 160,
    calories: 400,
    activityTrainingLoad: 60.5,
    aerobicTrainingEffect: 3.1,
    anaerobicTrainingEffect: 0.5,
    trainingEffectLabel: "TEMPO",
    vigorousIntensityMinutes: 20,
    hrTimeInZone_1: 60,
    hrTimeInZone_2: 300,
    hrTimeInZone_3: 900,
    hrTimeInZone_4: 540,
    startLatitude: 51.5,
    ownerFullName: "Not stored",
    ownerProfileImageUrlLarge: "https://example.com/not-stored.jpg",
  };

  it("maps a run and dates it by its own offset", () => {
    const [row] = mapActivities([run]);
    expect(row).toMatchObject({
      sourceRecordId: "1000000001",
      sport: "running",
      tzOffsetMin: 60,
      localDate: "2026-04-09",
      distanceM: 5000.25,
      avgHr: 150,
      avgCadence: 160,
      sourceTrainingLoad: 60.5,
      hrZoneS: [60, 300, 900, 540, 0],
      hasRoute: true,
    });
    expect(row?.startTime.toISOString()).toBe("2026-04-09T21:30:00.000Z");
  });

  it("puts a late-night run abroad on the local date", () => {
    const [row] = mapActivities([{ ...run, startTimeGMT: "2026-04-09 20:00:00", startTimeLocal: "2026-04-10 01:30:00" }]);
    expect(row?.localDate).toBe("2026-04-10");
    expect(row?.tzOffsetMin).toBe(330);
  });

  it("never copies personal profile fields", () => {
    const json = JSON.stringify(mapActivities([run]));
    expect(json).not.toContain("not-stored");
    expect(json).not.toContain("Not stored");
  });

  it("handles strength sessions with no distance or route", () => {
    const [row] = mapActivities([
      { activityId: 7, activityType: { typeKey: "strength_training" }, startTimeGMT: "2026-05-01 07:00:00", duration: 2400 },
    ]);
    expect(row).toMatchObject({ sport: "strength_training", distanceM: null, hasRoute: false, hrZoneS: null });
  });
});

describe("mapVo2max", () => {
  it("maps running (generic) and cycling values", () => {
    expect(
      mapVo2max([
        { generic: { sport: "RUNNING", calendarDate: "2026-04-09", vo2MaxValue: 45, vo2MaxPreciseValue: 45.4 }, cycling: null },
        { generic: null, cycling: { calendarDate: "2026-04-10", vo2MaxValue: 41 } },
      ]),
    ).toEqual([
      { localDate: "2026-04-09", sport: "running", value: 45.4 },
      { localDate: "2026-04-10", sport: "cycling", value: 41 },
    ]);
  });
});

describe("isEmptyPayload", () => {
  it("recognises Garmin's empty responses", () => {
    expect(isEmptyPayload([])).toBe(true);
    expect(isEmptyPayload(null)).toBe(true);
    expect(isEmptyPayload({ dailyWeightSummaries: [], totalAverage: {} })).toBe(true);
    expect(isEmptyPayload([{ x: 1 }])).toBe(false);
  });
});

describe("mapWeight", () => {
  const entry = (ts: number, grams: number, bodyFat: number | null = null) => ({
    samplePk: ts,
    calendarDate: "2026-11-20",
    timestampGMT: ts,
    date: ts,
    weight: grams,
    bodyFat,
    sourceType: "INDEX_SCALE",
  });

  it("keeps the day's latest weigh-in, in kg", () => {
    const rows = mapWeight({
      dailyWeightSummaries: [
        { summaryDate: "2026-11-20", allWeightMetrics: [entry(2000, 80_350, 18.4), entry(1000, 81_000)], latestWeight: entry(2000, 80_350, 18.4) },
        { summaryDate: "2026-11-21", allWeightMetrics: [], latestWeight: null },
      ],
      totalAverage: {},
    });
    expect(rows).toEqual([{ localDate: "2026-11-20", weightKg: 80.35, bodyFatPct: 18.4 }]);
  });

  it("drops implausible body fat but keeps the weight", () => {
    const rows = mapWeight({ dailyWeightSummaries: [{ summaryDate: "2026-11-20", latestWeight: entry(1, 70_000, 0) }] });
    expect(rows).toEqual([{ localDate: "2026-11-20", weightKg: 70, bodyFatPct: null }]);
  });

  it("throws on values that are not grams, so the payload is quarantined", () => {
    expect(() => mapWeight({ dailyWeightSummaries: [{ summaryDate: "2026-11-20", latestWeight: entry(1, 80.3) }] })).toThrow(/plausible/);
  });

  it("throws on an unexpected outer shape", () => {
    expect(() => mapWeight({ dateWeightList: [] })).toThrow();
  });

  it("maps an empty range to no rows", () => {
    expect(mapWeight({ dailyWeightSummaries: [], totalAverage: {} })).toEqual([]);
    expect(mapWeight(null)).toEqual([]);
  });
});

describe("mapSleepLevels", () => {
  const level = (start: string, end: string, activityLevel: number) => ({ startGMT: start, endGMT: end, activityLevel });

  it("maps levels to stages for the night's date", () => {
    const rows = mapSleepLevels({
      dailySleepDTO: { calendarDate: "2026-11-20", sleepStartTimestampGMT: 1 },
      sleepLevels: [level("2026-11-19T23:10:00.0", "2026-11-20T00:40:00.0", 1.0), level("2026-11-20T00:40:00.0", "2026-11-20T01:30:00.0", 0), level("2026-11-20T01:30:00.0", "2026-11-20T01:40:00.0", 3), level("2026-11-20T01:40:00.0", "2026-11-20T02:20:00.0", 2)],
    });
    expect(rows.map((r) => [r.stage, r.startTime.toISOString()])).toEqual([
      ["light", "2026-11-19T23:10:00.000Z"],
      ["deep", "2026-11-20T00:40:00.000Z"],
      ["awake", "2026-11-20T01:30:00.000Z"],
      ["rem", "2026-11-20T01:40:00.000Z"],
    ]);
    expect(rows.every((r) => r.localDate === "2026-11-20")).toBe(true);
  });

  it("maps a night without levels, or no night, to nothing", () => {
    expect(mapSleepLevels({ dailySleepDTO: { calendarDate: "2026-11-20" } })).toEqual([]);
    expect(mapSleepLevels({ dailySleepDTO: { calendarDate: null }, sleepLevels: [] })).toEqual([]);
    expect(mapSleepLevels(null)).toEqual([]);
  });

  it("throws on an unknown shape or level, so the response is quarantined", () => {
    expect(() => mapSleepLevels({ sleepLevels: [] })).toThrow();
    expect(() => mapSleepLevels({ dailySleepDTO: { calendarDate: "2026-11-20" }, sleepLevels: [level("2026-11-20T00:00:00.0", "2026-11-20T01:00:00.0", 7)] })).toThrow(/level 7/);
  });
});
