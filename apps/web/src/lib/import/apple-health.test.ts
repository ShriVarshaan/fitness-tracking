import { describe, expect, it } from "vitest";
import { AppleHealthParser, appleSport, parseAppleDate } from "./apple-health";
import { activityRow, dailyRow, sleepRow, vo2Row, weightRow } from "./rows";

const rec = (type: string, start: string, end: string, value: string | number, extra = "") =>
  `<Record type="${type}" sourceName="${extra || "iPhone"}" unit="${unitFor(type)}" creationDate="${end}" startDate="${start}" endDate="${end}" value="${value}"/>`;
const unitFor = (type: string) =>
  ({
    HKQuantityTypeIdentifierStepCount: "count",
    HKQuantityTypeIdentifierDistanceWalkingRunning: "km",
    HKQuantityTypeIdentifierActiveEnergyBurned: "kcal",
    HKQuantityTypeIdentifierBasalEnergyBurned: "kJ",
    HKQuantityTypeIdentifierRestingHeartRate: "count/min",
    HKQuantityTypeIdentifierBodyMass: "lb",
    HKQuantityTypeIdentifierBodyFatPercentage: "%",
    HKQuantityTypeIdentifierVO2Max: "mL/min·kg",
  })[type] ?? "";
const sleep = (start: string, end: string, value: string, source = "Apple Watch") =>
  `<Record type="HKCategoryTypeIdentifierSleepAnalysis" sourceName="${source}" startDate="${start}" endDate="${end}" value="HKCategoryValueSleepAnalysis${value}"/>`;

/** Feed XML in small pieces, so tags are split across chunks as they will be in real files. */
function parse(xml: string, chunk = 37) {
  const p = new AppleHealthParser();
  for (let i = 0; i < xml.length; i += chunk) p.push(xml.slice(i, i + chunk));
  return p.finish();
}

const wrap = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [
<!ELEMENT HealthData (ExportDate,Me,(Record|Workout)*)>
<!ATTLIST Record type CDATA #REQUIRED>
]>
<HealthData locale="en_GB">
 <ExportDate value="2026-11-20 10:00:00 +0000"/>
${body}
</HealthData>`;

describe("parseAppleDate", () => {
  it("reads the instant, offset and local date", () => {
    expect(parseAppleDate("2026-06-01 07:30:00 +0100")).toEqual({ ms: Date.parse("2026-06-01T06:30:00Z"), tz: 60, date: "2026-06-01" });
    expect(parseAppleDate("2026-06-01 23:30:00 -0500")?.tz).toBe(-300);
    expect(parseAppleDate("nonsense")).toBeNull();
  });
});

describe("AppleHealthParser", () => {
  it("keeps the source with the most steps per day instead of adding iPhone and Watch", () => {
    const r = parse(
      wrap(
        [
          rec("HKQuantityTypeIdentifierStepCount", "2026-11-18 08:00:00 +0000", "2026-11-18 08:10:00 +0000", 1000, "iPhone"),
          rec("HKQuantityTypeIdentifierStepCount", "2026-11-18 12:00:00 +0000", "2026-11-18 12:10:00 +0000", 500, "iPhone"),
          rec("HKQuantityTypeIdentifierStepCount", "2026-11-18 08:00:00 +0000", "2026-11-18 08:10:00 +0000", 1400, "Apple Watch"),
          rec("HKQuantityTypeIdentifierDistanceWalkingRunning", "2026-11-18 08:00:00 +0000", "2026-11-18 08:10:00 +0000", 1.2),
          rec("HKQuantityTypeIdentifierActiveEnergyBurned", "2026-11-18 08:00:00 +0000", "2026-11-18 08:10:00 +0000", 300),
          rec("HKQuantityTypeIdentifierBasalEnergyBurned", "2026-11-18 08:00:00 +0000", "2026-11-18 08:10:00 +0000", 4184),
          rec("HKQuantityTypeIdentifierRestingHeartRate", "2026-11-18 08:00:00 +0000", "2026-11-18 08:00:00 +0000", 52),
          rec("HKQuantityTypeIdentifierHeartRate", "2026-11-18 08:00:00 +0000", "2026-11-18 08:00:00 +0000", 140),
        ].join("\n"),
      ),
    );
    expect(r.daily).toHaveLength(1);
    const d = dailyRow.parse(r.daily[0]);
    expect(d).toMatchObject({ localDate: "2026-11-18", steps: 1500, distanceM: 1200, activeKcal: 300, restingKcal: 1000, totalKcal: 1300, restingHr: 52, tzOffsetMin: 0 });
  });

  it("groups sleep stages into a night dated to the morning of waking", () => {
    const r = parse(
      wrap(
        [
          sleep("2026-11-17 22:30:00 +0000", "2026-11-18 07:00:00 +0000", "InBed", "iPhone"),
          sleep("2026-11-17 23:00:00 +0000", "2026-11-18 01:00:00 +0000", "AsleepCore"),
          sleep("2026-11-18 01:00:00 +0000", "2026-11-18 02:00:00 +0000", "AsleepDeep"),
          sleep("2026-11-18 02:00:00 +0000", "2026-11-18 02:10:00 +0000", "Awake"),
          sleep("2026-11-18 02:10:00 +0000", "2026-11-18 04:10:00 +0000", "AsleepCore"),
          sleep("2026-11-18 04:10:00 +0000", "2026-11-18 05:40:00 +0000", "AsleepREM"),
          // A nap the same afternoon: too short to be a night.
          sleep("2026-11-18 14:00:00 +0000", "2026-11-18 14:40:00 +0000", "AsleepCore"),
        ].join("\n"),
      ),
    );
    expect(r.sleep).toHaveLength(1);
    const n = r.sleep[0]!;
    expect(sleepRow.parse(n)).toBeTruthy();
    expect(n).toMatchObject({
      localDate: "2026-11-18",
      startTime: "2026-11-17T23:00:00.000Z",
      endTime: "2026-11-18T05:40:00.000Z",
      totalSleepS: 6.5 * 3600,
      deepS: 3600,
      lightS: 4 * 3600,
      remS: 1.5 * 3600,
      awakeS: 600,
      awakeCount: 1,
    });
    expect(n.stages.map((s) => s.stage)).toEqual(["light", "deep", "awake", "light", "rem"]);
  });

  it("keeps the source with the most sleep when two apps record the same night", () => {
    const r = parse(
      wrap(
        [
          sleep("2026-11-17 23:00:00 +0000", "2026-11-18 06:00:00 +0000", "AsleepUnspecified", "SleepApp"),
          sleep("2026-11-17 23:30:00 +0000", "2026-11-18 03:30:00 +0000", "AsleepCore"),
          sleep("2026-11-18 03:30:00 +0000", "2026-11-18 06:30:00 +0000", "AsleepDeep"),
        ].join("\n"),
      ),
    );
    expect(r.sleep).toHaveLength(1);
    expect(r.sleep[0]).toMatchObject({ totalSleepS: 7 * 3600, deepS: 3 * 3600 });
  });

  it("reads workouts with heart rate and distance from their statistics", () => {
    const r = parse(
      wrap(`<Workout workoutActivityType="HKWorkoutActivityTypeRunning" duration="30" durationUnit="min" sourceName="Apple Watch" startDate="2026-11-18 07:00:00 +0100" endDate="2026-11-18 07:30:00 +0100">
  <MetadataEntry key="HKIndoorWorkout" value="0"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" startDate="2026-11-18 07:00:00 +0100" endDate="2026-11-18 07:30:00 +0100" average="152.4" minimum="90" maximum="171" unit="count/min"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierDistanceWalkingRunning" startDate="2026-11-18 07:00:00 +0100" endDate="2026-11-18 07:30:00 +0100" sum="5.4" unit="km"/>
  <WorkoutStatistics type="HKQuantityTypeIdentifierActiveEnergyBurned" startDate="2026-11-18 07:00:00 +0100" endDate="2026-11-18 07:30:00 +0100" sum="380" unit="kcal"/>
  <WorkoutRoute sourceName="Apple Watch"><FileReference path="/workout-routes/route.gpx"/></WorkoutRoute>
 </Workout>
<Workout workoutActivityType="HKWorkoutActivityTypeTraditionalStrengthTraining" duration="45" durationUnit="min" totalEnergyBurned="200" totalEnergyBurnedUnit="kcal" sourceName="Apple Watch" startDate="2026-11-19 18:00:00 +0000" endDate="2026-11-19 18:45:00 +0000"/>`),
    );
    expect(r.activities.map((a) => activityRow.parse(a))).toMatchObject([
      { sport: "running", startTime: "2026-11-18T06:00:00.000Z", tzOffsetMin: 60, localDate: "2026-11-18", durationS: 1800, distanceM: 5400, avgSpeedMps: 3, avgHr: 152, maxHr: 171, kcal: 380 },
      { sport: "strength_training", durationS: 2700, distanceM: null, kcal: 200 },
    ]);
  });

  it("converts weight, body fat and VO2 max, latest per day", () => {
    const r = parse(
      wrap(
        [
          rec("HKQuantityTypeIdentifierBodyMass", "2026-11-18 07:00:00 +0000", "2026-11-18 07:00:00 +0000", 180),
          rec("HKQuantityTypeIdentifierBodyMass", "2026-11-18 21:00:00 +0000", "2026-11-18 21:00:00 +0000", 181),
          rec("HKQuantityTypeIdentifierBodyFatPercentage", "2026-11-18 07:00:00 +0000", "2026-11-18 07:00:00 +0000", 0.184),
          rec("HKQuantityTypeIdentifierVO2Max", "2026-11-18 07:00:00 +0000", "2026-11-18 07:00:00 +0000", 48.27),
        ].join("\n"),
      ),
    );
    expect(r.weight.map((w) => weightRow.parse(w))).toEqual([{ localDate: "2026-11-18", weightKg: 82.1, bodyFatPct: 18.4 }]);
    expect(r.vo2max.map((v) => vo2Row.parse(v))).toEqual([{ localDate: "2026-11-18", sport: "running", value: 48.3 }]);
  });

  it("counts unreadable records and ignores types it doesn't read", () => {
    const r = parse(
      wrap(
        [
          rec("HKQuantityTypeIdentifierStepCount", "yesterday", "today", 10),
          rec("HKQuantityTypeIdentifierHeartRateVariabilitySDNN", "2026-11-18 07:00:00 +0000", "2026-11-18 07:00:00 +0000", 45),
        ].join("\n"),
      ),
    );
    expect(r.skipped).toBe(1);
    expect(r.daily).toEqual([]);
  });
});

describe("appleSport", () => {
  it("maps workout types to sport keys", () => {
    expect(appleSport("HKWorkoutActivityTypeCycling")).toBe("cycling");
    expect(appleSport("HKWorkoutActivityTypeFunctionalStrengthTraining")).toBe("strength_training");
    expect(appleSport("HKWorkoutActivityTypeMindAndBody")).toBe("mind_and_body");
  });
});
