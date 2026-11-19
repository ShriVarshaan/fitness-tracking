import type { LocalDate } from "@ft/core";
import type { DeriveInputs, DerivedRow } from "../derive";
import type { RuleContext } from "./types";

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** Assemble the rule context for `date` from stored inputs and derived rows. */
export function buildRuleContext(
  date: LocalDate,
  inputs: DeriveInputs & {
    spo2Overnight?: Array<{ date: LocalDate; value: number }>;
    planned?: Array<{ date: LocalDate; intensity: string; durationS: number | null }>;
  },
  rows: DerivedRow[],
): RuleContext {
  const ctx: RuleContext = {
    date,
    sleepNeedS: inputs.sleepNeedS,
    hrvNightly: new Map(inputs.hrv.map((p) => [p.date, p.value])),
    hrvBaseline: new Map(),
    rhrDaily: new Map(inputs.rhr.map((p) => [p.date, p.value])),
    rhrBaseline: new Map(),
    sleep: new Map(inputs.sleep.map((p) => [p.date, p.value])),
    spo2Overnight: new Map((inputs.spo2Overnight ?? []).map((p) => [p.date, p.value])),
    sleepDebt: new Map(),
    acwr: new Map(),
    ctl: new Map(),
    readiness: new Map(),
    planned: new Map(),
  };
  for (const p of inputs.planned ?? []) {
    const list = ctx.planned!.get(p.date) ?? [];
    list.push({ intensity: p.intensity, durationS: p.durationS });
    ctx.planned!.set(p.date, list);
  }

  for (const r of rows) {
    if (r.value === null) continue;
    const c = r.components;
    switch (r.metricCode) {
      case "hrv_baseline": {
        const bandLowMs = num(c.bandLowMs);
        const bandHighMs = num(c.bandHighMs);
        const baselineMs = num(c.baselineMs);
        if (bandLowMs !== undefined && bandHighMs !== undefined && baselineMs !== undefined) {
          ctx.hrvBaseline.set(r.localDate, { rollingMs: r.value, bandLowMs, bandHighMs, baselineMs, confidence: r.confidence });
        }
        break;
      }
      case "rhr_baseline": {
        const baselineBpm = num(c.baselineBpm);
        const elevatedAboveBpm = num(c.elevatedAboveBpm);
        if (baselineBpm !== undefined && elevatedAboveBpm !== undefined) {
          ctx.rhrBaseline.set(r.localDate, { baselineBpm, elevatedAboveBpm, confidence: r.confidence });
        }
        break;
      }
      case "sleep_debt":
        ctx.sleepDebt.set(r.localDate, { debtS: r.value, confidence: r.confidence });
        break;
      case "acwr":
        ctx.acwr.set(r.localDate, r.value);
        break;
      case "ctl":
        ctx.ctl.set(r.localDate, r.value);
        break;
      case "readiness":
        ctx.readiness!.set(r.localDate, { score: r.value, confidence: r.confidence });
        break;
    }
  }
  return ctx;
}
