import "server-only";
import type { Generate } from "@ft/advice";
import { aiAvailable, createGenerate, wordingModels } from "./ai-config";

export {
  aiAvailable,
  aiModel,
  aiProviderOptions,
  chatModels,
  isTransientProviderError,
  languageModel,
  withModelFallback,
} from "./ai-config";

/**
 * The model calls used by rewordInsight (with fallback), or null when AI isn't
 * configured on the server. Short timeout so a slow provider never holds up the sync.
 */
export function aiGenerate(): { generate: Generate; model: () => string } | null {
  if (!aiAvailable()) return null;
  return createGenerate(wordingModels(), (from, to, err) =>
    console.warn(`AI wording: ${from} unavailable (${err instanceof Error ? err.message.slice(0, 120) : "error"}), trying ${to}`),
  );
}
