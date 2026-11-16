import { clamp } from "./common";

export const READINESS_WEIGHTS = { hrv: 30, rhr: 20, sleep: 20, regularity: 10, load: 20 } as const;
export type ReadinessComponent = keyof typeof READINESS_WEIGHTS;

/** Logistic map from a z-score to 0–100 (50 at z = 0). */
export const logistic = (z: number) => 100 / (1 + Math.exp(-1.5 * z));

export interface ReadinessInputs {
  /** z of 7-day lnRMSSD vs baseline, with its confidence. */
  hrv?: { z: number; confidence: number } | null;
  /** Today's resting HR vs baseline mean and SD. */
  rhr?: { todayBpm: number; baselineBpm: number; sdBpm: number; confidence: number } | null;
  /** Last night's sleep vs need. */
  sleep?: { actualS: number; needS: number } | null;
  /** Sleep Regularity Index 0–100 (not available until sleep epochs exist). */
  regularity?: { sri: number; confidence: number } | null;
  /** Form (TSB) from the load model and the model's confidence. */
  load?: { tsb: number; confidence: number } | null;
}

export interface Readiness {
  score: number;
  confidence: number;
  components: Partial<Record<ReadinessComponent, number>>;
  missing: ReadinessComponent[];
}

/**
 * Readiness (estimate): weighted mean of component scores, weights renormalised
 * over available components; ≥ 50% of the weight is required. Composite
 * heuristic informed by Plews et al. 2013 and Buchheit 2014. UNVALIDATED:
 * labelled as our estimate, never as Garmin's Training Readiness or Body Battery.
 * Formula: docs/PLAN.md §6.
 */
export function readiness(inputs: ReadinessInputs): (Readiness & { ok: true }) | { ok: false; reason: string; missing: ReadinessComponent[] } {
  const scores: Partial<Record<ReadinessComponent, number>> = {};
  const confidences: number[] = [];

  if (inputs.hrv) {
    scores.hrv = logistic(inputs.hrv.z);
    confidences.push(inputs.hrv.confidence);
  }
  if (inputs.rhr) {
    const { todayBpm, baselineBpm, sdBpm } = inputs.rhr;
    const z = sdBpm > 1e-9 ? -(todayBpm - baselineBpm) / sdBpm : 0;
    scores.rhr = logistic(z);
    confidences.push(inputs.rhr.confidence);
  }
  if (inputs.sleep && inputs.sleep.needS > 0) {
    scores.sleep = clamp((100 * (inputs.sleep.actualS / inputs.sleep.needS - 0.5)) / 0.5, 0, 100);
    confidences.push(1);
  }
  if (inputs.regularity) {
    scores.regularity = clamp(inputs.regularity.sri, 0, 100);
    confidences.push(inputs.regularity.confidence);
  }
  if (inputs.load && inputs.load.confidence >= 0.5) {
    scores.load = logistic(inputs.load.tsb / 10);
    confidences.push(inputs.load.confidence);
  }

  const available = Object.keys(scores) as ReadinessComponent[];
  const missing = (Object.keys(READINESS_WEIGHTS) as ReadinessComponent[]).filter((c) => !(c in scores));
  const weight = available.reduce((w, c) => w + READINESS_WEIGHTS[c], 0);
  if (weight < 50) {
    return { ok: false, reason: `only ${weight}% of the readiness inputs are available (needs 50%)`, missing };
  }

  const score = available.reduce((sum, c) => sum + READINESS_WEIGHTS[c] * scores[c]!, 0) / weight;
  const meanConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length;
  return { ok: true, score, confidence: (weight / 100) * meanConfidence, components: scores, missing };
}
