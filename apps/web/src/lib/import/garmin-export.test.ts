import { describe, expect, it } from "vitest";
import { detectActivityUnits, garminExportKind, mapGarminExportActivities, mapGarminExportDaily, mapGarminExportSleep } from "./garmin-export";
import { activityRow, dailyRow, sleepRow } from "./rows";

describe("garminExportKind", () => {
  it("picks the files we read by path", () => {
    expect(garminExportKind("DI_CONNECT/DI-Connect-Aggregator/UDSFile_2023-01-01_2023-04-11.json")).toBe("daily");
    expect(garminExportKind("DI_CONNECT/DI-Connect-Wellness/2023-01-01_2023-04-11_123_sleepData.json")).toBe("sleep");
    expect(garminExportKind("DI_CONNECT/DI-Connect-Fitness/me@example.com_0_summarizedActivities.json")).toBe("activities");
    expect(garminExportKind("DI_CONNECT/DI-Connect-Uploaded-Files/UploadedFiles_0-_Part1.zip")).toBeNull();
  });
});

describe("mapGarminExportDaily", () => {
  it("maps a daily summary, with stress and Body Battery from their lists", () => {
    const { rows, skipped } = mapGarminExportDaily([
      {
        calendarDate: "2023-03-02",
        wellnessStartTimeGmt: "2023-03-02T00:00:00.0",
        wellnessStartTimeLocal: "2023-03-02T01:00:00.0",
        totalSteps: 10432,
        dailyStepGoal: 8000,
        totalDistanceMeters: 8120,
        totalKilocalories: 2650,
        activeKilocalories: 820,
        bmrKilocalories: 1830,
        moderateIntensityMinutes: 22,
        vigorousIntensityMinutes: 31,
        restingHeartRate: 48,
        minHeartRate: 44,
        maxHeartRate: 171,
        allDayStress: { aggregatorList: [{ type: "ASLEEP", averageStressLevel: 12 }, { type: "TOTAL", averageStressLevel: 29, maxStressLevel: 95, restDuration: 30000, lowDuration: 20000, mediumDuration: 5000, highDuration: 1000 }] },
        bodyBattery: { bodyBatteryStatList: [{ bodyBatteryStatType: "HIGHEST", statsValue: 88 }, { bodyBatteryStatType: "LOWEST", statsValue: 14 }] },
        respiration: { avgWakingRespirationValue: 15, highestRespirationValue: 22, lowestRespirationValue: 9 },
      },
      { calendarDate: null },
    ]);
    expect(skipped).toBe(1);
    expect(dailyRow.parse(rows[0])).toMatchObject({
      localDate: "2023-03-02",
      tzOffsetMin: 60,
      steps: 10432,
      totalKcal: 2650,
      restingHr: 48,
      stressAvg: 29,
      stressRestS: 30000,
      bodyBatteryHigh: 88,
      bodyBatteryLow: 14,
      respirationAvg: 15,
    });
  });

  it("treats Garmin's negative numbers as no reading", () => {
    const { rows } = mapGarminExportDaily([{ calendarDate: "2023-03-02", restingHeartRate: -1, totalSteps: -2 }]);
    expect(rows[0]).toMatchObject({ restingHr: null, steps: null });
  });
});

describe("mapGarminExportSleep", () => {
  it("maps a night with export record id", () => {
    const { rows, skipped } = mapGarminExportSleep([
      {
        calendarDate: "2023-03-02",
        sleepStartTimestampGMT: "2023-03-01T23:10:00.0",
        sleepEndTimestampGMT: "2023-03-02T06:40:00.0",
        deepSleepSeconds: 5400,
        lightSleepSeconds: 16200,
        remSleepSeconds: 5400,
        awakeSleepSeconds: 1200,
        awakeCount: 2,
        averageRespiration: 14,
        avgSleepStress: 11.5,
        sleepScores: { overallScore: 81 },
        spo2SleepSummary: { averageSPO2: 95, lowestSPO2: 88, averageHR: 50 },
      },
      { calendarDate: "2023-03-03" },
    ]);
    expect(skipped).toBe(1);
    expect(sleepRow.parse(rows[0])).toMatchObject({
      sourceRecordId: "export-2023-03-02",
      startTime: "2023-03-01T23:10:00.000Z",
      endTime: "2023-03-02T06:40:00.000Z",
      totalSleepS: 27000,
      sourceScore: 81,
      avgSpo2: 95,
      lowestSpo2: 88,
      avgHr: 50,
    });
  });
});

describe("mapGarminExportActivities", () => {
  // Published export samples: distance in cm, durations in ms, speed in cm/ms.
  const run = {
    activityId: 4370000001,
    name: "London Running",
    activityType: "running",
    startTimeGmt: 1577262145000,
    startTimeLocal: 1577262145000,
    duration: 1839876.95,
    movingDuration: 1830000,
    distance: 523428,
    elevationGain: 3800,
    elevationLoss: 3600,
    avgSpeed: 0.2845,
    maxSpeed: 0.41,
    avgHr: 150,
    maxHr: 172,
    calories: 1673,
    aerobicTrainingEffect: 3.1,
    hrTimeInZone_1: 60000,
    hrTimeInZone_2: 300000,
    hrTimeInZone_3: 900000,
    hrTimeInZone_4: 500000,
    hrTimeInZone_5: 70000,
    lapCount: 6,
  };

  it("detects centimetre/millisecond units and converts", () => {
    const { rows, units } = mapGarminExportActivities([{ summarizedActivitiesExport: [run] }]);
    expect(units).toBe("cm-ms");
    const a = activityRow.parse(rows[0]);
    expect(a).toMatchObject({
      sourceRecordId: "4370000001",
      sport: "running",
      startTime: "2019-12-25T08:22:25.000Z",
      tzOffsetMin: 0,
      distanceM: 5234.28,
      ascentM: 38,
      avgHr: 150,
      kcal: null,
      lapCount: 6,
    });
    expect(a.durationS).toBeCloseTo(1839.88, 1);
    expect(a.avgSpeedMps).toBeCloseTo(5234.28 / 1830, 3);
    expect(a.maxSpeedMps).toBeCloseTo(4.1);
    // Zone times added up to more than the activity in seconds, so they were milliseconds.
    expect(a.hrZoneS).toEqual([60, 300, 900, 500, 70]);
  });

  it("detects metre units too", () => {
    expect(detectActivityUnits([{ distance: 5234, duration: 1830000, avgSpeed: 2.86 }])).toBe("m-ms");
  });

  it("tells metres and seconds apart from centimetres and milliseconds by duration", () => {
    expect(detectActivityUnits([{ distance: 5000, duration: 1800, avgSpeed: 2.8 }])).toBe("m-s");
    const { rows } = mapGarminExportActivities([{ activityId: 1, startTimeGmt: 1, distance: 5000, duration: 1800, avgSpeed: 2.8, maxSpeed: 4 }]);
    expect(rows[0]).toMatchObject({ distanceM: 5000, durationS: 1800, maxSpeedMps: 4 });
  });

  it("refuses units it can't recognise", () => {
    expect(() => mapGarminExportActivities([{ activityId: 1, startTimeGmt: 1, distance: 5000, duration: 1800, avgSpeed: 280 }])).toThrow(/units/);
  });
});
