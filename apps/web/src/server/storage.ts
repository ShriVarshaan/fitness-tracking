import "server-only";
import type { Db } from "@ft/db";
import { sql } from "drizzle-orm";

/** Supabase Free database limit (docs/PLAN.md §12). */
export const DATABASE_LIMIT_BYTES = 500 * 1024 * 1024;

/** Tables holding per-user rows. A fixed list (never user input), so it is safe to splice into SQL. */
const USER_TABLES = [
  "activity_streams",
  "raw_ingest",
  "activities",
  "activity_laps",
  "activity_sets",
  "daily_summaries",
  "sleep_sessions",
  "hrv_daily",
  "vo2max_daily",
  "derived_daily",
  "findings",
  "insights",
  "chat_conversations",
  "chat_messages",
  "sync_jobs",
] as const;

/**
 * Approximate storage for one user (sum of row sizes; excludes indexes) and
 * the whole database's size. Runs on the privileged connection, filtered by
 * the verified user id.
 */
export async function storageUsage(db: Db, userId: string): Promise<{ userBytes: number; databaseBytes: number }> {
  const parts = USER_TABLES.map((t) => sql`(select coalesce(sum(pg_column_size(x.*)), 0) from ${sql.identifier(t)} x where x.user_id = ${userId})`);
  const [row] = await db.execute<{ user_bytes: string; database_bytes: string }>(sql`
    select (${sql.join(parts, sql` + `)})::bigint as user_bytes,
           pg_database_size(current_database()) as database_bytes`);
  return { userBytes: Number(row?.user_bytes ?? 0), databaseBytes: Number(row?.database_bytes ?? 0) };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
