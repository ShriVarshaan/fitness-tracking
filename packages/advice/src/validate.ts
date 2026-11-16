import { formatValue } from "./format";
import type { Insight } from "./insight";

const NUMBER = /\d+(?:[.,]\d+)?/g;

/**
 * Numeric grounding: every number in the text must appear in the formatted
 * evidence (value or baseline), or be one of the fixed reference numbers used
 * in templates. Returns the numbers that couldn't be traced.
 */
export function ungroundedNumbers(text: string, insight: Pick<Insight, "evidence">, allowed: string[] = ["0.8", "1.3", "3", "7", "2"]): string[] {
  const grounded = new Set<string>(allowed);
  for (const e of insight.evidence) {
    for (const v of [e.value, e.baseline]) {
      if (v === undefined) continue;
      for (const n of formatValue(v, e.unit).match(NUMBER) ?? []) grounded.add(n);
    }
  }
  return (text.match(NUMBER) ?? []).filter((n) => !grounded.has(n));
}

/** Every action must cite at least one evidence id that exists. */
export function uncitedActions(insight: Pick<Insight, "actions" | "evidence">): string[] {
  const ids = new Set(insight.evidence.map((e) => e.id));
  return insight.actions.filter((a) => a.evidenceIds.length === 0 || a.evidenceIds.some((id) => !ids.has(id))).map((a) => a.text);
}

/** Phrases advice must never contain (diagnosis, dosing, extreme diets). */
const BLOCKED = [
  /\byou (?:have|may have|might have|probably have)\b/i,
  /\bdiagnos/i,
  /\b\d+\s?(?:mg|mcg|µg|iu)\b/i,
  /\b(?:dose|dosage|prescri)/i,
  /\b(?:fast(?:ing)? for|skip (?:meals|eating)|under \d{3,4} ?kcal)\b/i,
];

export function safetyViolations(text: string): string[] {
  return BLOCKED.filter((re) => re.test(text)).map((re) => re.source);
}

export interface ValidationResult {
  ok: boolean;
  ungrounded: string[];
  uncited: string[];
  unsafe: string[];
  missingDataAcknowledged: boolean;
}

/** Hard checks every insight must pass before display (docs/PLAN.md §7). */
export function validateInsight(insight: Insight): ValidationResult {
  const text = [insight.headline, ...insight.body, ...insight.actions.map((a) => a.text)].join(" ");
  const ungrounded = ungroundedNumbers(text, insight);
  const uncited = uncitedActions(insight);
  const unsafe = safetyViolations(text);
  const missingDataAcknowledged = insight.confidence !== "low" || insight.missingData.length > 0 || insight.evidence.length === 0;
  return { ok: !ungrounded.length && !uncited.length && !unsafe.length && missingDataAcknowledged, ungrounded, uncited, unsafe, missingDataAcknowledged };
}
