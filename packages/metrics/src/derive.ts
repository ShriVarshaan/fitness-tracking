import { createHash } from "node:crypto";
import { addDays, daysBetween, type LocalDate } from "@ft/core";
import { hrvBaseline, rhrBaseline } from "./baselines";
import { ALGO_VERSION, type DatedValue } from "./common";
import { activityTrimp, acwr, hrMaxFromActivities, pmc } from "./load";
import { readiness } from "./readiness";
import { sleepDebt, sleepRegularityIndex, type SleepNightIntervals } from "./sleep";

export interface DeriveInputs {
  /** Garmin overnight RMSSD (ms) per wake date. */
  hrv: DatedValue[];
  /** Resting HR (bpm) per day. */
  rhr: DatedValue[];
  /** Total sleep (s) per wake date. */
  sleep: DatedValue[];
  /** One entry per activity: its local date and HR zone seconds (null if none). */
  activities: Array<{
    /** Source record id, so per-activity loads can be shown on the activity page. */
    id?: string | null;
    date: LocalDate;
    zoneSeconds: number[] | null;
    /** Per-second HR from the FIT file, when fetched. */
    hrStream?: { timeS: number[]; hr: Array<number | null> } | null;
  }>;
  sleepNeedS: number;
  /** Asleep intervals per night, for the Sleep Regularity Index (optional). */
  sleepNights?: SleepNightIntervals[];
}

export interface DerivedRow {
  localDate: LocalDate;
  metricCode: string;
  value: number | null;
  components: Record<string, unknown>;
  confidence: number;
  algoVersion: number;
  inputsHash: string;
}

const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);
const round = (v: number, dp = 3) => Math.round(v * 10 ** dp) / 10 ** dp;

/** Every date from the first input to the last. */
function dateSpan(inputs: DeriveInputs): { from: LocalDate; to: LocalDate } | null {
  const dates = [...inputs.hrv, ...inputs.rhr, ...inputs.sleep, ...inputs.activities].map((x) => x.date).sort();
  return dates.length ? { from: dates[0]!, to: dates.at(-1)! } : null;
}

/**
 * Compute every derived metric for every day of the history. Pure: the caller
 * loads inputs and stores rows. Whole-history recomputation keeps EWMA metrics
 * correct when late data arrives (cheap at one person's scale).
 */
export function deriveAll(inputs: DeriveInputs): DerivedRow[] {
  const span = dateSpan(inputs);
  if (!span) return [];

  // Daily training load from activities (Edwards TRIMP).
  const dailyLoad = new Map<LocalDate, number>();
  const missingLoad = new Map<LocalDate, number>();
  // Activities without Garmin zone times fall back to zones computed from their HR stream (v2).
  const hrMax = hrMaxFromActivities(inputs.activities.flatMap((a) => (a.hrStream ? [a.hrStream.hr] : [])));
  const fromStream = new Map<LocalDate, number>();
  const perActivity = new Map<LocalDate, Array<{ id: string; load: number | null; fromStream: boolean }>>();
  for (const a of inputs.activities) {
    const { value: t, fromStream: viaStream } = activityTrimp(a, hrMax);
    if (a.id) {
      const list = perActivity.get(a.date) ?? [];
      list.push({ id: a.id, load: t === null ? null : round(t, 1), fromStream: viaStream });
      perActivity.set(a.date, list);
    }
    if (viaStream) fromStream.set(a.date, (fromStream.get(a.date) ?? 0) + 1);
    if (t === null) missingLoad.set(a.date, (missingLoad.get(a.date) ?? 0) + 1);
    else dailyLoad.set(a.date, (dailyLoad.get(a.date) ?? 0) + t);
  }
  const pmcDays = new Map(pmc(dailyLoad, span.from, span.to).map((d) => [d.date, d]));
  const acwrDays = new Map(acwr(dailyLoad, span.from, span.to).map((d) => [d.date, d]));
  const rhrByDate = new Map(inputs.rhr.map((d) => [d.date, d.value]));
  const sleepByDate = new Map(inputs.sleep.map((d) => [d.date, d.value]));

  const rows: DerivedRow[] = [];
  const push = (
    localDate: LocalDate,
    metricCode: keyof typeof ALGO_VERSION | "ctl" | "atl" | "tsb" | "trimp_daily",
    value: number | null,
    components: Record<string, unknown>,
    confidence: number,
    algo: keyof typeof ALGO_VERSION,
    inputsForHash: unknown,
  ) =>
    rows.push({
      localDate,
      metricCode,
      value: value === null ? null : round(value),
      components,
      confidence: round(confidence),
      algoVersion: ALGO_VERSION[algo],
      inputsHash: hash([ALGO_VERSION[algo], inputsForHash]),
    });

  const days = daysBetween(span.from, span.to);
  for (let i = 0; i <= days; i++) {
    const date = addDays(span.from, i);

    const hrv = hrvBaseline(inputs.hrv, date);
    push(
      date,
      "hrv_baseline",
      hrv.ok ? hrv.rollingMs : null,
      hrv.ok
        ? { baselineMs: round(hrv.baselineMs), bandLowMs: round(hrv.bandLowMs), bandHighMs: round(hrv.bandHighMs), z: round(hrv.z), nights: hrv.nights }
        : { reason: hrv.reason },
      hrv.ok ? hrv.confidence : 0,
      "hrv_baseline",
      inputs.hrv.filter((p) => daysBetween(p.date, date) >= 0 && daysBetween(p.date, date) < 60),
    );

    const rhr = rhrBaseline(inputs.rhr, date);
    push(
      date,
      "rhr_baseline",
      rhr.ok ? rhr.rollingBpm : null,
      rhr.ok
        ? { baselineBpm: round(rhr.baselineBpm), sdBpm: round(rhr.sdBpm), elevatedAboveBpm: round(rhr.elevatedAboveBpm), days: rhr.days }
        : { reason: rhr.reason },
      rhr.ok ? rhr.confidence : 0,
      "rhr_baseline",
      inputs.rhr.filter((p) => daysBetween(p.date, date) >= 0 && daysBetween(p.date, date) < 60),
    );

    const debt = sleepDebt(inputs.sleep, date, inputs.sleepNeedS);
    push(
      date,
      "sleep_debt",
      debt.ok ? debt.debtS : null,
      debt.ok ? { nights: debt.nights, needS: inputs.sleepNeedS } : { reason: debt.reason },
      debt.ok ? debt.confidence : 0,
      "sleep_debt",
      [inputs.sleepNeedS, inputs.sleep.filter((p) => daysBetween(p.date, date) >= 0 && daysBetween(p.date, date) < 7)],
    );

    const sri = sleepRegularityIndex(inputs.sleepNights ?? [], date);
    push(
      date,
      "sri",
      sri.ok ? sri.sri : null,
      sri.ok ? { pairs: sri.pairs, approximate: sri.approximate } : { reason: sri.reason },
      sri.ok ? sri.confidence : 0,
      "sri",
      (inputs.sleepNights ?? [])
        .filter((n) => daysBetween(n.date, date) >= 0 && daysBetween(n.date, date) < 14)
        .map((n) => [n.date, n.tzOffsetMin, n.asleep, n.fromStages]),
    );

    const day = pmcDays.get(date)!;
    const loadComponents = {
      activitiesWithoutHrZones: missingLoad.get(date) ?? 0,
      zonesFromHrStream: fromStream.get(date) ?? 0,
      ...(fromStream.has(date) && hrMax ? { hrMaxBpm: hrMax } : {}),
      ...(perActivity.has(date) ? { activities: [...perActivity.get(date)!].sort((x, y) => x.id.localeCompare(y.id)) } : {}),
    };
    push(date, "trimp_daily", day.load, loadComponents, 1, "trimp_edwards", [day.load, loadComponents]);
    // The PMC depends on the whole history up to this date; hash today's state.
    const pmcState = [round(day.ctl, 6), round(day.atl, 6)];
    push(date, "ctl", day.ctl, {}, day.confidence, "pmc", pmcState);
    push(date, "atl", day.atl, {}, day.confidence, "pmc", pmcState);
    push(date, "tsb", day.tsb, {}, day.confidence, "pmc", pmcState);

    const a = acwrDays.get(date)!;
    push(
      date,
      "acwr",
      a.ratio,
      a.ratio === null ? { reason: "needs 28 days of history and some recent training load" } : { acute: round(a.acute), chronic: round(a.chronic) },
      a.ratio === null ? 0 : 1,
      "acwr",
      [round(a.acute, 6), round(a.chronic, 6)],
    );

    const rhrToday = rhrByDate.get(date);
    const sleepToday = sleepByDate.get(date);
    const ready = readiness({
      hrv: hrv.ok ? { z: hrv.z, confidence: hrv.confidence } : null,
      rhr: rhr.ok && rhrToday ? { todayBpm: rhrToday, baselineBpm: rhr.baselineBpm, sdBpm: rhr.sdBpm, confidence: rhr.confidence } : null,
      sleep: sleepToday ? { actualS: sleepToday, needS: inputs.sleepNeedS } : null,
      regularity: sri.ok ? { sri: sri.sri, confidence: sri.confidence } : null,
      load: { tsb: day.tsb, confidence: day.confidence },
    });
    push(
      date,
      "readiness",
      ready.ok ? ready.score : null,
      ready.ok
        ? { components: Object.fromEntries(Object.entries(ready.components).map(([k, v]) => [k, round(v, 1)])), missing: ready.missing }
        : { reason: ready.reason, missing: ready.missing },
      ready.ok ? ready.confidence : 0,
      "readiness",
      [hrv.ok ? round(hrv.z, 6) : null, rhrToday ?? null, sleepToday ?? null, round(day.tsb, 6), inputs.sleepNeedS, sri.ok ? round(sri.sri, 6) : null],
    );
  }
  return rows;
}
