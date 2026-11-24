import type { ActivityImportRow, DailyImportRow, SleepImportRow, StageInterval, Vo2ImportRow, WeightImportRow } from "./rows";

/**
 * Apple Health export (Health app → profile → Export All Health Data): a ZIP
 * holding apple_health_export/export.xml, which can run to gigabytes. The
 * parser takes the XML in text chunks and keeps only per-day aggregates, sleep
 * samples and workouts, so memory stays small.
 *
 * What is read (anything else is skipped):
 * - Steps, walking/running distance, active and resting energy, flights:
 *   summed per day **per source**, keeping the source with the largest total
 *   (iPhone and Watch both record steps; adding them would double count).
 * - Resting heart rate (daily mean), body mass and body fat (latest per day),
 *   VO2 max (Apple's estimate, latest per day, stored as running).
 * - Sleep stages (iOS 16+: core, deep, REM, awake; older: asleep), grouped into
 *   nights per source; each night keeps the source with the most sleep.
 * - Workouts, with average and maximum heart rate where Apple recorded them.
 *
 * Not read: HRV, because Apple reports SDNN and this app's HRV is Garmin's
 * RMSSD (different metrics, never mixed); SpO2 and respiration (spot checks,
 * not overnight averages); per-second heart rate; workout routes.
 */

type Attrs = Record<string, string>;

const ATTR_RE = /([A-Za-z_:][\w:.-]*)="([^"]*)"/g;
const unescape = (s: string) =>
  s.includes("&") ? s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&") : s;

function attrs(tag: string): Attrs {
  const out: Attrs = {};
  for (const m of tag.matchAll(ATTR_RE)) out[m[1]!] = unescape(m[2]!);
  return out;
}

/** "2024-01-15 07:50:00 +0100" → instant (ms), UTC offset (min) and local date. */
export function parseAppleDate(s: string | undefined): { ms: number; tz: number; date: string } | null {
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-])(\d{2})(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const tz = (m[3] === "-" ? -1 : 1) * (Number(m[4]) * 60 + Number(m[5]));
  const ms = Date.parse(`${m[1]}T${m[2]}Z`) - tz * 60_000;
  return Number.isNaN(ms) ? null : { ms, tz, date: m[1]! };
}

const DISTANCE_M: Record<string, number> = { m: 1, km: 1000, mi: 1609.344, yd: 0.9144, ft: 0.3048, cm: 0.01 };
const ENERGY_KCAL: Record<string, number> = { kcal: 1, Cal: 1, cal: 0.001, kJ: 1 / 4.184, J: 1 / 4184 };
const MASS_KG: Record<string, number> = { kg: 1, g: 0.001, lb: 0.45359237, oz: 0.028349523125, st: 6.35029318 };
const DURATION_S: Record<string, number> = { s: 1, min: 60, hr: 3600, h: 3600, ms: 0.001 };

function convert(value: string | undefined, unit: string | undefined, table: Record<string, number>): number | null {
  const v = Number(value);
  const f = unit !== undefined ? table[unit] : undefined;
  return Number.isFinite(v) && f !== undefined ? v * f : null;
}

/** HKWorkoutActivityType suffix → this app's sport keys (Garmin's names where one exists). */
const SPORTS: Record<string, string> = {
  Running: "running",
  Walking: "walking",
  Hiking: "hiking",
  Cycling: "cycling",
  Swimming: "lap_swimming",
  TraditionalStrengthTraining: "strength_training",
  FunctionalStrengthTraining: "strength_training",
  HighIntensityIntervalTraining: "hiit",
  Yoga: "yoga",
  Pilates: "pilates",
  Rowing: "rowing",
  Elliptical: "elliptical",
  StairClimbing: "stair_climbing",
  CrossCountrySkiing: "cross_country_skiing",
  DownhillSkiing: "resort_skiing",
  Snowboarding: "resort_snowboarding",
  Tennis: "tennis",
  Soccer: "soccer",
  Golf: "golf",
  Dance: "dance",
  CoreTraining: "strength_training",
  MixedCardio: "cardio",
  Other: "other",
};

export function appleSport(type: string | undefined): string {
  const key = (type ?? "").replace(/^HKWorkoutActivityType/, "");
  return SPORTS[key] ?? (key.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase().replace(/[^a-z0-9_]/g, "") || "other");
}

const ADDITIVE: Record<string, { field: "steps" | "distanceM" | "activeKcal" | "restingKcal" | "floorsAscended"; table?: Record<string, number> }> = {
  HKQuantityTypeIdentifierStepCount: { field: "steps" },
  HKQuantityTypeIdentifierDistanceWalkingRunning: { field: "distanceM", table: DISTANCE_M },
  HKQuantityTypeIdentifierActiveEnergyBurned: { field: "activeKcal", table: ENERGY_KCAL },
  HKQuantityTypeIdentifierBasalEnergyBurned: { field: "restingKcal", table: ENERGY_KCAL },
  HKQuantityTypeIdentifierFlightsClimbed: { field: "floorsAscended" },
};

const SLEEP_VALUES: Record<string, StageInterval["stage"] | "in_bed"> = {
  HKCategoryValueSleepAnalysisInBed: "in_bed",
  HKCategoryValueSleepAnalysisAsleep: "asleep",
  HKCategoryValueSleepAnalysisAsleepUnspecified: "asleep",
  HKCategoryValueSleepAnalysisAsleepCore: "light",
  HKCategoryValueSleepAnalysisAsleepDeep: "deep",
  HKCategoryValueSleepAnalysisAsleepREM: "rem",
  HKCategoryValueSleepAnalysisAwake: "awake",
};

interface SleepSample {
  source: string;
  start: number;
  end: number;
  endTz: number;
  stage: StageInterval["stage"];
}

interface WorkoutDraft {
  attrs: Attrs;
  hrAvg: number | null;
  hrMax: number | null;
  distanceM: number | null;
  kcal: number | null;
}

export interface AppleNight extends SleepImportRow {
  stages: StageInterval[];
}

export interface AppleHealthResult {
  daily: DailyImportRow[];
  sleep: AppleNight[];
  activities: ActivityImportRow[];
  weight: WeightImportRow[];
  vo2max: Vo2ImportRow[];
  /** Records of the types we read that couldn't be parsed (bad date or value). */
  skipped: number;
}

/** A gap longer than this between sleep samples starts a new night. */
const NIGHT_GAP_MS = 90 * 60_000;
/** Shorter sleeps are naps and are not stored as nights. */
const MIN_NIGHT_ASLEEP_S = 3 * 3600;

export class AppleHealthParser {
  private buf = "";
  private skipped = 0;
  /** `${date}|${field}|${source}` → sum. */
  private additive = new Map<string, number>();
  private tzByDate = new Map<string, number>();
  private restingHr = new Map<string, { sum: number; n: number }>();
  private latest = new Map<string, { ms: number; value: number }>();
  private sleep: SleepSample[] = [];
  private workouts: WorkoutDraft[] = [];
  private openWorkout: WorkoutDraft | null = null;

  /** Feed the next chunk of export.xml text. */
  push(text: string): void {
    this.buf += text;
    let pos = 0;
    for (;;) {
      const open = this.buf.indexOf("<", pos);
      if (open < 0) {
        pos = this.buf.length;
        break;
      }
      const close = this.buf.indexOf(">", open);
      if (close < 0) {
        pos = open;
        break;
      }
      this.tag(this.buf.slice(open + 1, close));
      pos = close + 1;
    }
    this.buf = this.buf.slice(pos);
  }

  private tag(t: string): void {
    if (t.startsWith("Record ")) return this.record(t);
    if (t.startsWith("Workout ") || t === "Workout") {
      const w: WorkoutDraft = { attrs: attrs(t), hrAvg: null, hrMax: null, distanceM: null, kcal: null };
      if (t.endsWith("/")) this.workouts.push(w);
      else this.openWorkout = w;
      return;
    }
    if (t.trim() === "/Workout") {
      if (this.openWorkout) this.workouts.push(this.openWorkout);
      this.openWorkout = null;
      return;
    }
    if (this.openWorkout && t.startsWith("WorkoutStatistics ")) {
      const a = attrs(t);
      const w = this.openWorkout;
      if (a.type === "HKQuantityTypeIdentifierHeartRate") {
        w.hrAvg = Number(a.average) || null;
        w.hrMax = Number(a.maximum) || null;
      } else if (/^HKQuantityTypeIdentifierDistance/.test(a.type ?? "")) {
        w.distanceM = convert(a.sum, a.unit, DISTANCE_M);
      } else if (a.type === "HKQuantityTypeIdentifierActiveEnergyBurned") {
        w.kcal = convert(a.sum, a.unit, ENERGY_KCAL);
      }
    }
  }

  private record(t: string): void {
    // Cheap check before parsing attributes: most records are heart rate samples we skip.
    const typeStart = t.indexOf('type="');
    if (typeStart < 0) return;
    const type = t.slice(typeStart + 6, t.indexOf('"', typeStart + 6));
    const add = ADDITIVE[type];
    const wanted =
      add ||
      type === "HKQuantityTypeIdentifierRestingHeartRate" ||
      type === "HKQuantityTypeIdentifierBodyMass" ||
      type === "HKQuantityTypeIdentifierBodyFatPercentage" ||
      type === "HKQuantityTypeIdentifierVO2Max" ||
      type === "HKCategoryTypeIdentifierSleepAnalysis";
    if (!wanted) return;

    const a = attrs(t);
    const start = parseAppleDate(a.startDate);
    if (!start) {
      this.skipped++;
      return;
    }
    const source = a.sourceName ?? "unknown";

    if (type === "HKCategoryTypeIdentifierSleepAnalysis") {
      const end = parseAppleDate(a.endDate);
      const stage = SLEEP_VALUES[a.value ?? ""];
      if (!end || !stage || end.ms <= start.ms) {
        if (stage !== "in_bed") this.skipped++;
        return;
      }
      if (stage === "in_bed") return;
      this.sleep.push({ source, start: start.ms, end: end.ms, endTz: end.tz, stage });
      return;
    }

    if (add) {
      const v = add.table ? convert(a.value, a.unit, add.table) : Number(a.value);
      if (v === null || !Number.isFinite(v) || v < 0) {
        this.skipped++;
        return;
      }
      const key = `${start.date}|${add.field}|${source}`;
      this.additive.set(key, (this.additive.get(key) ?? 0) + v);
      if (!this.tzByDate.has(start.date)) this.tzByDate.set(start.date, start.tz);
      return;
    }

    const value = Number(a.value);
    if (!Number.isFinite(value)) {
      this.skipped++;
      return;
    }
    if (type === "HKQuantityTypeIdentifierRestingHeartRate") {
      const r = this.restingHr.get(start.date) ?? { sum: 0, n: 0 };
      this.restingHr.set(start.date, { sum: r.sum + value, n: r.n + 1 });
      return;
    }
    let v: number | null = value;
    if (type === "HKQuantityTypeIdentifierBodyMass") v = convert(a.value, a.unit, MASS_KG);
    if (type === "HKQuantityTypeIdentifierBodyFatPercentage") v = value <= 1 ? value * 100 : value;
    if (v === null) {
      this.skipped++;
      return;
    }
    const key = `${type}|${start.date}`;
    const cur = this.latest.get(key);
    if (!cur || start.ms >= cur.ms) this.latest.set(key, { ms: start.ms, value: v });
  }

  /** Call once the whole file has been pushed. */
  finish(): AppleHealthResult {
    return {
      daily: this.dailyRows(),
      sleep: this.nights(),
      activities: this.activityRows(),
      weight: this.weightRows(),
      vo2max: this.vo2Rows(),
      skipped: this.skipped,
    };
  }

  private dailyRows(): DailyImportRow[] {
    // Best source per day and field: the one with the largest total.
    const best = new Map<string, Partial<Record<string, number>>>();
    for (const [key, sum] of this.additive) {
      const [date, field] = key.split("|") as [string, string];
      const day = best.get(date) ?? {};
      if ((day[field] ?? -1) < sum) day[field] = sum;
      best.set(date, day);
    }
    for (const [date, r] of this.restingHr) {
      const day = best.get(date) ?? {};
      day.restingHr = r.sum / r.n;
      best.set(date, day);
    }
    const rnd = (v: number | undefined) => (v === undefined ? null : Math.round(v));
    const keep = (v: number | undefined, max: number) => (v === undefined || v > max ? null : v);
    return [...best.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([localDate, d]) => {
        const active = keep(d.activeKcal, 15_000);
        const resting = keep(d.restingKcal, 10_000);
        const hr = d.restingHr !== undefined && d.restingHr >= 20 && d.restingHr <= 200 ? Math.round(d.restingHr) : null;
        return {
          localDate,
          tzOffsetMin: this.tzByDate.get(localDate) ?? null,
          steps: d.steps !== undefined && d.steps <= 200_000 ? Math.round(d.steps) : null,
          distanceM: keep(d.distanceM, 500_000),
          floorsAscended: keep(rnd(d.floorsAscended) ?? undefined, 2_000),
          activeKcal: active,
          restingKcal: resting,
          totalKcal: active !== null && resting !== null ? active + resting : null,
          restingHr: hr,
        };
      });
  }

  private nights(): AppleNight[] {
    const bySource = new Map<string, SleepSample[]>();
    for (const s of this.sleep) {
      const list = bySource.get(s.source);
      if (list) list.push(s);
      else bySource.set(s.source, [s]);
    }
    const candidates: Array<AppleNight & { staged: boolean }> = [];
    for (const samples of bySource.values()) {
      samples.sort((a, b) => a.start - b.start);
      let group: SleepSample[] = [];
      let lastEnd = -Infinity;
      const flush = () => {
        const night = this.night(group);
        if (night) candidates.push(night);
        group = [];
      };
      for (const s of samples) {
        if (group.length && s.start - lastEnd > NIGHT_GAP_MS) flush();
        group.push(s);
        lastEnd = group.length === 1 ? s.end : Math.max(lastEnd, s.end);
      }
      flush();
    }
    // One night per wake date: the most sleep wins; with a tie, the one with stages.
    const byDate = new Map<string, AppleNight & { staged: boolean }>();
    for (const c of candidates) {
      const cur = byDate.get(c.localDate);
      const score = (n: { totalSleepS?: number | null; staged: boolean }) => (n.totalSleepS ?? 0) + (n.staged ? 0.5 : 0);
      if (!cur || score(c) > score(cur)) byDate.set(c.localDate, c);
    }
    return [...byDate.values()].sort((a, b) => a.localDate.localeCompare(b.localDate)).map((n) => {
        const night: AppleNight & { staged?: boolean } = { ...n };
        delete night.staged;
        return night;
      });
  }

  private night(group: SleepSample[]): (AppleNight & { staged: boolean }) | null {
    const asleep = group.filter((s) => s.stage !== "awake");
    if (!asleep.length) return null;
    const secs = (stage: StageInterval["stage"]) => group.filter((s) => s.stage === stage).reduce((n, s) => n + (s.end - s.start) / 1000, 0);
    // Overlapping samples from one source are rare; merge them so time isn't counted twice.
    const merged: Array<[number, number]> = [];
    for (const s of [...asleep].sort((a, b) => a.start - b.start)) {
      const last = merged.at(-1);
      if (last && s.start <= last[1]) last[1] = Math.max(last[1], s.end);
      else merged.push([s.start, s.end]);
    }
    const totalSleepS = Math.round(merged.reduce((n, [a, b]) => n + (b - a) / 1000, 0));
    if (totalSleepS < MIN_NIGHT_ASLEEP_S) return null;
    const start = merged[0]![0];
    const lastAsleep = asleep.reduce((a, b) => (b.end > a.end ? b : a));
    const end = lastAsleep.end;
    const tz = lastAsleep.endTz;
    const localDate = new Date(end + tz * 60_000).toISOString().slice(0, 10);
    const staged = group.some((s) => s.stage === "deep" || s.stage === "rem" || s.stage === "light");
    const awake = group.filter((s) => s.stage === "awake" && s.start >= start && s.end <= end);
    return {
      sourceRecordId: `apple-sleep-${localDate}`,
      localDate,
      startTime: new Date(start).toISOString(),
      endTime: new Date(end).toISOString(),
      tzOffsetMin: tz,
      totalSleepS,
      deepS: staged ? Math.round(secs("deep")) : null,
      lightS: staged ? Math.round(secs("light")) : null,
      remS: staged ? Math.round(secs("rem")) : null,
      awakeS: awake.length ? Math.round(awake.reduce((n, s) => n + (s.end - s.start) / 1000, 0)) : null,
      awakeCount: awake.length || null,
      staged,
      stages: group
        .filter((s) => s.start >= start && s.end <= end)
        .sort((a, b) => a.start - b.start)
        .map((s) => ({ start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString(), stage: s.stage })),
    };
  }

  private activityRows(): ActivityImportRow[] {
    const rows: ActivityImportRow[] = [];
    for (const w of this.workouts) {
      const start = parseAppleDate(w.attrs.startDate);
      const end = parseAppleDate(w.attrs.endDate);
      if (!start) {
        this.skipped++;
        continue;
      }
      const sport = appleSport(w.attrs.workoutActivityType);
      const durationS = convert(w.attrs.duration, w.attrs.durationUnit ?? "min", DURATION_S) ?? (end ? (end.ms - start.ms) / 1000 : null);
      const distanceM = w.distanceM ?? convert(w.attrs.totalDistance, w.attrs.totalDistanceUnit, DISTANCE_M);
      const kcal = w.kcal ?? convert(w.attrs.totalEnergyBurned, w.attrs.totalEnergyBurnedUnit, ENERGY_KCAL);
      const ok = (v: number | null, max: number) => (v !== null && Number.isFinite(v) && v >= 0 && v <= max ? v : null);
      const dur = ok(durationS, 7 * 86_400);
      const dist = ok(distanceM, 2_000_000);
      const hr = (v: number | null) => (v !== null && v >= 20 && v <= 250 ? Math.round(v) : null);
      rows.push({
        sourceRecordId: `apple-${new Date(start.ms).toISOString()}-${sport}`,
        sport,
        name: null,
        startTime: new Date(start.ms).toISOString(),
        tzOffsetMin: start.tz,
        localDate: start.date,
        durationS: dur,
        distanceM: dist && dist > 0 ? dist : null,
        avgSpeedMps: dist && dur ? ok(dist / dur, 100) : null,
        avgHr: hr(w.hrAvg),
        maxHr: hr(w.hrMax),
        kcal: ok(kcal, 20_000),
      });
    }
    return rows;
  }

  private latestRows(type: string): Array<{ date: string; value: number }> {
    const out: Array<{ date: string; value: number }> = [];
    for (const [key, v] of this.latest) {
      const [t, date] = key.split("|") as [string, string];
      if (t === type) out.push({ date, value: v.value });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  private weightRows(): WeightImportRow[] {
    const fat = new Map(this.latestRows("HKQuantityTypeIdentifierBodyFatPercentage").map((r) => [r.date, r.value]));
    return this.latestRows("HKQuantityTypeIdentifierBodyMass")
      .filter((r) => r.value >= 20 && r.value <= 400)
      .map((r) => {
        const f = fat.get(r.date);
        return { localDate: r.date, weightKg: Math.round(r.value * 100) / 100, bodyFatPct: f !== undefined && f >= 2 && f <= 75 ? Math.round(f * 10) / 10 : null };
      });
  }

  private vo2Rows(): Vo2ImportRow[] {
    return this.latestRows("HKQuantityTypeIdentifierVO2Max")
      .filter((r) => r.value >= 10 && r.value <= 100)
      .map((r) => ({ localDate: r.date, sport: "running" as const, value: Math.round(r.value * 10) / 10 }));
  }
}
