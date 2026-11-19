import { addDays, type LocalDate } from "@ft/core";

/**
 * Synthetic data for accounts without Garmin (e.g. recruiters trying the app).
 * Deterministic for a given seed, plausible for a recreational runner, and
 * includes one rough week (short sleep, HRV dip, raised resting HR) so the
 * rules and insights have something to show. Never mixed with real data.
 */

export const DEMO_DAYS = 120;

/** Small seeded PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface DemoDay {
  localDate: LocalDate;
  steps: number;
  stepsGoal: number;
  distanceM: number;
  restingHr: number;
  stressAvg: number;
  bodyBatteryHigh: number;
  bodyBatteryLow: number;
  intensityMinModerate: number;
  intensityMinVigorous: number;
  intensityMinGoal: number;
  restingKcal: number;
  activeKcal: number;
  totalKcal: number;
}

export interface DemoSleep {
  localDate: LocalDate;
  startTime: Date;
  endTime: Date;
  totalSleepS: number;
  deepS: number;
  lightS: number;
  remS: number;
  awakeS: number;
  sourceScore: number;
  sourceScoreQualifier: string;
  sleepNeedMin: number;
  avgSpo2: number;
}

export interface DemoHrv {
  localDate: LocalDate;
  lastNightAvgMs: number;
  weeklyAvgMs: number;
  baselineBalancedLowMs: number;
  baselineBalancedUpperMs: number;
  sourceStatus: string;
}

export interface DemoActivity {
  sourceRecordId: string;
  sport: "running" | "strength_training";
  name: string;
  localDate: LocalDate;
  startTime: Date;
  durationS: number;
  movingS: number;
  distanceM: number | null;
  avgHr: number;
  maxHr: number;
  avgSpeedMps: number | null;
  kcal: number;
  hrZoneS: number[];
  aerobicTe: number;
  anaerobicTe: number;
}

export interface DemoData {
  days: DemoDay[];
  sleep: DemoSleep[];
  hrv: DemoHrv[];
  activities: DemoActivity[];
}

const UTC_OFFSET_MIN = 0; // demo data lives in UTC (GMT) to keep it simple

/** Generate `DEMO_DAYS` days ending on `today`. */
export function generateDemoData(today: LocalDate, seed = 42): DemoData {
  const r = rng(seed);
  const noise = (sd: number) => (r() + r() + r() - 1.5) * sd * 1.15; // ~normal
  const round = (v: number, dp = 0) => Math.round(v * 10 ** dp) / 10 ** dp;
  const start = addDays(today, -(DEMO_DAYS - 1));
  const roughFrom = DEMO_DAYS - 35; // a rough week about 5 weeks ago
  const roughTo = roughFrom + 6;

  const out: DemoData = { days: [], sleep: [], hrv: [], activities: [] };
  const hrvHistory: number[] = [];

  for (let i = 0; i < DEMO_DAYS; i++) {
    const date = addDays(start, i);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
    const rough = i >= roughFrom && i <= roughTo;
    const block = 1 + 0.15 * Math.floor(i / 28); // training builds every 4 weeks

    // Sleep (dated to the wake-up morning)
    const sleepS = Math.max(4 * 3600, (rough ? 5.6 : 7.6) * 3600 + noise(rough ? 1500 : 1800));
    const wake = new Date(`${date}T06:45:00Z`).getTime() + noise(900) * 1000;
    const awakeS = round(1200 + Math.abs(noise(600)));
    const deepS = round(sleepS * (0.17 + noise(0.02)));
    const remS = round(sleepS * (0.22 + noise(0.03)));
    out.sleep.push({
      localDate: date,
      startTime: new Date(wake - (sleepS + awakeS) * 1000),
      endTime: new Date(wake),
      totalSleepS: round(sleepS),
      deepS,
      remS,
      lightS: round(sleepS - deepS - remS),
      awakeS,
      sourceScore: Math.max(30, Math.min(95, round(78 + (sleepS - 7.5 * 3600) / 300 + noise(5)))),
      sourceScoreQualifier: sleepS > 7 * 3600 ? "GOOD" : sleepS > 6 * 3600 ? "FAIR" : "POOR",
      sleepNeedMin: 480,
      avgSpo2: round(95.5 + noise(1), 1),
    });

    // HRV and resting HR respond to the rough week
    const hrv = Math.max(30, 68 + noise(6) - (rough ? 14 + (i - roughFrom) * 1.2 : 0));
    hrvHistory.push(hrv);
    const week = hrvHistory.slice(-7);
    const weekly = week.reduce((a, b) => a + b, 0) / week.length;
    out.hrv.push({
      localDate: date,
      lastNightAvgMs: round(hrv),
      weeklyAvgMs: round(weekly),
      baselineBalancedLowMs: 60,
      baselineBalancedUpperMs: 78,
      sourceStatus: weekly < 60 ? "UNBALANCED" : "BALANCED",
    });
    const rhr = round(51 + noise(1.5) + (rough ? 6 + (i - roughFrom) * 0.4 : 0));

    // Activities: runs Tue/Thu/Sat (long run Sat), strength Mon/Wed; none in the rough week after day 2
    let vigorous = 0;
    let moderate = 0;
    const train = !(rough && i - roughFrom > 1);
    if (train && [2, 4, 6].includes(weekday)) {
      const long = weekday === 6;
      const km = (long ? 11 : 6.5) * block + noise(0.8);
      const speed = (long ? 2.85 : 3.05) + noise(0.08);
      const dur = (km * 1000) / speed;
      const z = long ? [0.05, 0.55, 0.32, 0.08, 0] : [0.05, 0.3, 0.4, 0.22, 0.03];
      const startTime = new Date(`${date}T17:30:00Z`);
      out.activities.push({
        sourceRecordId: `demo-${date}-run`,
        sport: "running",
        name: long ? "Long run" : weekday === 4 ? "Tempo run" : "Easy run",
        localDate: date,
        startTime,
        durationS: round(dur),
        movingS: round(dur * 0.98),
        distanceM: round(km * 1000),
        avgHr: round(long ? 148 : 156 + noise(3)),
        maxHr: round(172 + noise(4)),
        avgSpeedMps: round(speed, 3),
        kcal: round(km * 68),
        hrZoneS: z.map((p) => round(p * dur)),
        aerobicTe: round(long ? 3.4 : 3.0 + noise(0.3), 1),
        anaerobicTe: round(weekday === 4 ? 1.5 : 0.3, 1),
      });
      vigorous += round((dur * (z[3]! + z[4]!)) / 60);
      moderate += round((dur * z[2]!) / 60);
    } else if (train && [1, 3].includes(weekday)) {
      const dur = 2700 + noise(300);
      out.activities.push({
        sourceRecordId: `demo-${date}-strength`,
        sport: "strength_training",
        name: "Strength",
        localDate: date,
        startTime: new Date(`${date}T07:15:00Z`),
        durationS: round(dur),
        movingS: round(dur),
        distanceM: null,
        avgHr: round(112 + noise(5)),
        maxHr: round(145 + noise(5)),
        avgSpeedMps: null,
        kcal: round(dur / 60 * 6.5),
        hrZoneS: [0.45, 0.4, 0.13, 0.02, 0].map((p) => round(p * dur)),
        aerobicTe: round(1.8 + noise(0.2), 1),
        anaerobicTe: round(1.2 + noise(0.2), 1),
      });
      moderate += round((dur * 0.13) / 60);
    }

    const steps = round(Math.max(2500, 8500 + noise(2500) + (vigorous + moderate) * 90 - (rough ? 2500 : 0)));
    // Energy use: resting about 1,700 kcal, plus walking (≈ 0.04 kcal a step) and recorded sessions.
    const restingKcal = round(1700 + noise(20));
    const activeKcal = round(steps * 0.04 + out.activities.filter((a) => a.localDate === date).reduce((k, a) => k + a.kcal, 0));
    out.days.push({
      localDate: date,
      steps,
      stepsGoal: 10000,
      distanceM: round(steps * 0.78),
      restingHr: rhr,
      stressAvg: round(Math.max(10, 30 + noise(6) + (rough ? 14 : 0))),
      bodyBatteryHigh: round(Math.min(100, Math.max(25, 82 + noise(8) - (rough ? 30 : 0)))),
      bodyBatteryLow: round(Math.max(5, 18 + noise(6) - (rough ? 8 : 0))),
      intensityMinModerate: moderate,
      intensityMinVigorous: vigorous,
      intensityMinGoal: 150,
      restingKcal,
      activeKcal,
      totalKcal: restingKcal + activeKcal,
    });
  }
  return out;
}

export const DEMO_TZ_OFFSET_MIN = UTC_OFFSET_MIN;
