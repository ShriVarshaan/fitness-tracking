import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Live check against the real Gemini models. Spends free-tier quota, so it is
// not part of `pnpm test`. Needs GOOGLE_GENERATIVE_AI_API_KEY (apps/web/.env.local).
export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("./apps/web/src/", import.meta.url)) }],
  },
  test: {
    include: ["apps/web/test/live/**/*.live.test.ts"],
    environment: "node",
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
