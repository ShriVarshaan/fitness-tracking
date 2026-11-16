import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export { schema };

/**
 * Server-only database client for trusted code (sync jobs, key handling).
 * It connects as the `postgres` role through Supabase's transaction pooler
 * (port 6543), which bypasses RLS, so every query must filter by user.
 * `prepare: false` is required by the transaction pooler.
 */
export function createDb(databaseUrl: string) {
  const client = postgres(databaseUrl, { prepare: false, max: 1 });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
