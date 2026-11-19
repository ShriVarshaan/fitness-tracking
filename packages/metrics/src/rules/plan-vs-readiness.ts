import { type Rule } from "./types";

/** Below this readiness estimate (0–100), a hard planned session earns a caution. */
export const PLAN_READINESS_THRESHOLD = 40;
/** The readiness estimate must be at least this confident to second-guess a plan. */
const MIN_CONFIDENCE = 0.5;

/**
 * PLAN_VS_READINESS: a hard or long session is planned for today, but the
 * readiness estimate is low. Heuristic (the 40 cut-off is ours, not from a
 * study); it suggests, it never cancels a plan.
 */
export const planVsReadiness: Rule = {
  id: "PLAN_VS_READINESS",
  version: 1,
  evaluate(ctx) {
    const planned = (ctx.planned?.get(ctx.date) ?? []).filter((p) => p.intensity === "hard" || p.intensity === "long");
    const ready = ctx.readiness?.get(ctx.date);
    if (!planned.length || !ready || ready.confidence < MIN_CONFIDENCE || ready.score >= PLAN_READINESS_THRESHOLD) return null;
    const longest = planned.reduce((m, p) => Math.max(m, p.durationS ?? 0), 0);
    return {
      ruleId: this.id,
      ruleVersion: this.version,
      severity: "caution",
      confidence: ready.confidence,
      evidence: [
        { id: "readiness_today", metric: "readiness", label: "Readiness estimate", value: Math.round(ready.score), unit: "score", window: "today", source: "estimate" },
        ...(longest > 0
          ? [{ id: "planned_duration", metric: "planned_duration", label: "Planned session", value: longest, unit: "s", window: "today's plan", source: "estimate" as const }]
          : []),
      ],
    };
  },
};
