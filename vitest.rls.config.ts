import { defineConfig } from "vitest/config";

// Database security tests; need a local Supabase stack (`pnpm exec supabase start`).
export default defineConfig({
  test: {
    include: ["packages/db/test/**/*.test.ts"],
    environment: "node",
    testTimeout: 20_000,
    fileParallelism: false,
  },
});
