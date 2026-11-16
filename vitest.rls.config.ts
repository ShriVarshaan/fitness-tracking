import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Database tests (RLS and end-to-end) against a local Supabase stack:
// `pnpm exec supabase start`, then `pnpm test:rls`.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: fileURLToPath(new URL("./apps/web/src/", import.meta.url)) },
      { find: "server-only", replacement: fileURLToPath(new URL("./test/stubs/server-only.ts", import.meta.url)) },
    ],
  },
  test: {
    include: ["packages/db/test/**/*.test.ts", "apps/web/test/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    fileParallelism: false,
  },
});
