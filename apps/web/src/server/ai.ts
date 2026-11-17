import "server-only";
import type { Generate } from "@ft/advice";
import { aiAvailable, aiModel, createGenerate } from "./ai-config";

export { aiAvailable, aiModel, aiProviderOptions, chatModel, languageModel } from "./ai-config";

/**
 * The model call used by rewordInsight, or null when AI isn't configured on the
 * server. Short timeout so a slow provider never holds up the sync.
 */
export function aiGenerate(): Generate | null {
  return aiAvailable() ? createGenerate(aiModel()) : null;
}
