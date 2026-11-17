import { google, type GoogleLanguageModelOptions } from "@ai-sdk/google";
import { rewordSchema, type Generate } from "@ft/advice";
import { generateText, Output } from "ai";

/**
 * Gemini settings shared by the app (through ./ai, which is server-only) and
 * the live model check (test/live), so both call the model the same way.
 * Model ids come from config: GEMINI_MODEL for insight wording,
 * GEMINI_CHAT_MODEL for chat. Decision record: docs/adr/0002-ai-provider-gemini.md.
 */
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const DEFAULT_CHAT_MODEL = "gemini-3.8-flash";

/** The provider reads GOOGLE_GENERATIVE_AI_API_KEY itself. */
export function aiAvailable(): boolean {
  return Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY);
}

export function aiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
}

export function chatModel(): string {
  return process.env.GEMINI_CHAT_MODEL?.trim() || DEFAULT_CHAT_MODEL;
}

/** Chat tries its own model, then the wording model (separate free-tier quota, usually less busy). */
export function chatModels(): string[] {
  return [...new Set([chatModel(), aiModel()])];
}

/** The model is busy or the free quota for it ran out: worth trying another model. */
export function isTransientProviderError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /high demand|overloaded|unavailable|503|429|quota|resource_exhausted|rate limit|try again later/i.test(msg);
}

/**
 * Run a model call on each model in turn until one isn't busy or out of
 * quota. Other errors are thrown straight away. Returns the model that answered.
 */
export async function withModelFallback<T>(
  models: string[],
  call: (model: string) => Promise<T>,
  onFallback?: (from: string, to: string, err: unknown) => void,
): Promise<{ result: T; model: string }> {
  for (let i = 0; ; i++) {
    const model = models[i]!;
    try {
      return { result: await call(model), model };
    } catch (err) {
      const next = models[i + 1];
      if (!next || !isTransientProviderError(err)) throw err;
      onFallback?.(model, next, err);
    }
  }
}

/** Rewording and data lookups need little reasoning; low thinking saves tokens and free-tier quota. */
export const aiProviderOptions = { google: { thinkingConfig: { thinkingLevel: "low" } } satisfies GoogleLanguageModelOptions };

export const languageModel = (id: string) => google(id);

/** One structured-output call for rewordInsight; no SDK retries (rewordInsight decides). */
export function createGenerate(model: string): Generate {
  return async ({ system, prompt }) => {
    const { output } = await generateText({
      model: languageModel(model),
      system,
      prompt,
      output: Output.object({ schema: rewordSchema }),
      maxRetries: 0,
      temperature: 0.4,
      abortSignal: AbortSignal.timeout(20_000),
      providerOptions: aiProviderOptions,
    });
    return output;
  };
}
