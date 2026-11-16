import "server-only";
import { groq } from "@ai-sdk/groq";
import { rewordSchema, type Generate } from "@ft/advice";
import { generateText, Output } from "ai";

/** Default Groq model; override with GROQ_MODEL. Model ids come from config, never hard-coded elsewhere. */
const DEFAULT_MODEL = "openai/gpt-oss-20b";

export function aiAvailable(): boolean {
  return Boolean(process.env.GROQ_API_KEY);
}

export function aiModel(): string {
  return process.env.GROQ_MODEL?.trim() || DEFAULT_MODEL;
}

/**
 * The model call used by rewordInsight, or null when AI isn't configured on the
 * server. One attempt per call (rewordInsight decides about retrying), short
 * timeout so a slow provider never holds up the sync.
 */
export function groqGenerate(): Generate | null {
  if (!aiAvailable()) return null;
  const model = aiModel();
  return async ({ system, prompt }) => {
    const { output } = await generateText({
      model: groq(model),
      system,
      prompt,
      output: Output.object({ schema: rewordSchema }),
      maxRetries: 0,
      temperature: 0.4,
      abortSignal: AbortSignal.timeout(20_000),
    });
    return output;
  };
}
