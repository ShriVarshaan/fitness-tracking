import "server-only";
import { google, type GoogleLanguageModelOptions } from "@ai-sdk/google";
import { rewordSchema, type Generate } from "@ft/advice";
import { generateText, Output } from "ai";

/**
 * Google Gemini (AI Studio API key). Model ids come from config, never
 * hard-coded elsewhere: GEMINI_MODEL for insight wording, GEMINI_CHAT_MODEL for chat.
 * Decision record: docs/adr/0002-ai-provider-gemini.md.
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

/**
 * The model call used by rewordInsight, or null when AI isn't configured on the
 * server. One attempt per call (rewordInsight decides about retrying), short
 * timeout so a slow provider never holds up the sync.
 */
export function aiGenerate(): Generate | null {
  if (!aiAvailable()) return null;
  const model = aiModel();
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
