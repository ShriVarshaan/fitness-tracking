import { createHash } from "node:crypto";
import { z } from "zod";
import { formatValue } from "./format";
import type { Insight } from "./insight";
import { validateInsight, type ValidationResult } from "./validate";

/**
 * Optional LLM wording (docs/PLAN.md §7). The template insight stays the source
 * of truth: the model only rewrites headline, body and action text, sees only
 * the evidence packet, and its output must pass the same validators. Red-flag
 * insights are never sent to a model.
 */

export const rewordSchema = z.object({
  headline: z.string().min(3).max(80),
  body: z.array(z.string().min(3).max(400)).min(1).max(8),
  actions: z
    .array(z.object({ text: z.string().min(3).max(200), evidenceIds: z.array(z.string()).min(1) }))
    .max(4),
});
export type Reworded = z.infer<typeof rewordSchema>;

export interface RewordRequest {
  system: string;
  prompt: string;
}

/** Calls the model and returns its structured output (already parsed JSON). */
export type Generate = (req: RewordRequest) => Promise<unknown>;

const SYSTEM = [
  "You rewrite a short morning wellness summary for one person so it reads naturally and warmly.",
  "Rules you must follow:",
  "- Use only the facts and numbers in the evidence list. Write every number exactly as it appears there. Do not add, round, convert or estimate any other number.",
  "- Keep every point from the draft; do not add new advice, causes, diagnoses, medicines, supplements or diets.",
  "- Each action must list the ids of the evidence it relies on.",
  "- Plain British English, second person, no exclamation marks, no markdown. Keep one paragraph per draft paragraph (at most 8).",
  "- This is general wellness information, not medical advice.",
].join("\n");

/** The only data the model sees: the draft text and the evidence numbers, formatted. */
export function buildRewordRequest(insight: Insight): RewordRequest {
  const evidence = [...new Map(insight.evidence.map((e) => [e.id, e])).values()].map((e) => ({
    id: e.id,
    label: e.label,
    value: formatValue(e.value, e.unit),
    ...(e.baseline !== undefined ? { usual: formatValue(e.baseline, e.unit) } : {}),
  }));
  const packet = {
    draft: { headline: insight.headline, body: insight.body, actions: insight.actions },
    evidence,
    missingData: insight.missingData,
    confidence: insight.confidence,
  };
  return { system: SYSTEM, prompt: `Rewrite this summary following the rules.\n\n${JSON.stringify(packet, null, 2)}` };
}

/** Stable fingerprint of what the model would be asked, to avoid re-asking for the same day. */
export function rewordKey(insight: Insight): string {
  return createHash("sha256").update(JSON.stringify(buildRewordRequest(insight))).digest("hex").slice(0, 16);
}

export type RewordOutcome =
  | { status: "reworded"; insight: Insight; attempts: number }
  | { status: "template"; insight: Insight; reason: "red_flag" | "no_findings" | "invalid" | "error"; attempts: number; detail?: string };

function merge(template: Insight, out: Reworded, model: string): Insight {
  return { ...template, headline: out.headline, body: out.body, actions: out.actions, model: model as Insight["model"] };
}

function describe(v: ValidationResult): string {
  return [
    v.ungrounded.length ? `ungrounded numbers: ${v.ungrounded.join(", ")}` : "",
    v.uncited.length ? "uncited actions" : "",
    v.unsafe.length ? "safety filter" : "",
    v.missingDataAcknowledged ? "" : "missing data not acknowledged",
  ]
    .filter(Boolean)
    .join("; ");
}

/**
 * Ask the model to reword the template insight. Retries once on invalid output,
 * then falls back to the template. Never throws.
 */
export async function rewordInsight(template: Insight, generate: Generate, model: string): Promise<RewordOutcome> {
  if (template.redFlags.length > 0) return { status: "template", insight: template, reason: "red_flag", attempts: 0 };
  if (template.evidence.length === 0) return { status: "template", insight: template, reason: "no_findings", attempts: 0 };

  const req = buildRewordRequest(template);
  let detail = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    let raw: unknown;
    try {
      raw = await generate(req);
    } catch (err) {
      const message = err instanceof Error ? err.message : "error";
      // The provider rejecting malformed output is the model's mistake, not an outage: count it as invalid.
      if (/schema|does not validate|failed_generation/i.test(message)) {
        detail = "output did not match the schema";
        continue;
      }
      return { status: "template", insight: template, reason: "error", attempts: attempt, detail: message };
    }
    const parsed = rewordSchema.safeParse(raw);
    if (!parsed.success) {
      detail = "output did not match the schema";
      continue;
    }
    const candidate = merge(template, parsed.data, model);
    const check = validateInsight(candidate);
    if (check.ok) return { status: "reworded", insight: candidate, attempts: attempt };
    detail = describe(check);
  }
  return { status: "template", insight: template, reason: "invalid", attempts: 2, detail };
}
