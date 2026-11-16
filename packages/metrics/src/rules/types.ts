import type { LocalDate } from "@ft/core";

export type Severity = "info" | "caution" | "red_flag";

/** One number a finding rests on. The advice layer may only cite these. */
export interface Evidence {
  /** Stable id within a finding set, e.g. "hrv_7d". */
  id: string;
  metric: string;
  label: string;
  value: number;
  unit: string;
  baseline?: number;
  /** Human description of the window, e.g. "7-night average". */
  window: string;
  source: "garmin" | "estimate";
}

export interface Finding {
  ruleId: string;
  ruleVersion: number;
  severity: Severity;
  confidence: number;
  evidence: Evidence[];
}

/** Per-day values the rules read. Every map is keyed by local date. */
export interface RuleContext {
  date: LocalDate;
  sleepNeedS: number;
  /** Garmin overnight HRV (ms). */
  hrvNightly: Map<LocalDate, number>;
  /** Our HRV baseline: 7-day geometric mean and band. */
  hrvBaseline: Map<LocalDate, { rollingMs: number; bandLowMs: number; bandHighMs: number; baselineMs: number; confidence: number }>;
  /** Garmin resting HR (bpm). */
  rhrDaily: Map<LocalDate, number>;
  /** Our resting-HR baseline. */
  rhrBaseline: Map<LocalDate, { baselineBpm: number; elevatedAboveBpm: number; confidence: number }>;
  /** Total sleep (s) per wake date. */
  sleep: Map<LocalDate, number>;
  /** Overnight average SpO2 (%) per wake date. */
  spo2Overnight: Map<LocalDate, number>;
  sleepDebt: Map<LocalDate, { debtS: number; confidence: number }>;
  acwr: Map<LocalDate, number>;
  ctl: Map<LocalDate, number>;
}

export interface Rule {
  id: string;
  version: number;
  evaluate(ctx: RuleContext): Finding | null;
}

export const r1 = (v: number) => Math.round(v * 10) / 10;
