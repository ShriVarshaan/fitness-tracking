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
