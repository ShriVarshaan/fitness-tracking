import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { METRICS } from "@ft/core";

const migrationsDir = join(import.meta.dirname, "../../../supabase/migrations");

describe("metric_definitions seed", () => {
  it("includes every metric in the registry", () => {
    const sql = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(migrationsDir, f), "utf8"))
      .join("\n");
    for (const code of Object.keys(METRICS)) {
      expect(sql, `seed is missing metric "${code}" — add it in a new migration`).toContain(`('${code}',`);
    }
  });
});
