import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  date,
  index,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createdAt, ownerReadPolicy, updatedAt, userId } from "./_shared";

/**
 * Connection state only. The API key and access token live in Supabase Vault
 * (see supabase/migrations/*_vault_helpers.sql), never in this table.
 */
export const garminConnection = pgTable(
  "garmin_connection",
  {
    userId: userId().primaryKey(),
    status: text("status", { enum: ["active", "key_invalid", "key_expired", "removed"] })
      .notNull()
      .default("active"),
    keyExpiresOn: date("key_expires_on"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    /** Per data type, e.g. { "dailies": "2026-11-16T10:30:00Z" }. */
    lastSyncedAt: jsonb("last_synced_at").$type<Record<string, string>>().notNull().default({}),
    backfillComplete: boolean("backfill_complete").notNull().default(false),
    /** When incremental jobs were last planned (cron runs more often than we re-plan). */
    lastPlannedAt: timestamp("last_planned_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [ownerReadPolicy("garmin_connection")],
).enableRLS();

export const syncJobs = pgTable(
  "sync_jobs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: userId(),
    kind: text("kind", { enum: ["backfill", "incremental"] }).notNull(),
    dataType: text("data_type").notNull(),
    /** Extra job target, e.g. the Garmin activity id for "activity_file" jobs. */
    ref: text("ref"),
    rangeFrom: timestamp("range_from", { withTimezone: true }).notNull(),
    rangeTo: timestamp("range_to", { withTimezone: true }).notNull(),
    status: text("status", { enum: ["queued", "running", "done", "failed"] })
      .notNull()
      .default("queued"),
    attempts: smallint("attempts").notNull().default(0),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("sync_jobs_claim_idx").on(t.status, t.runAfter),
    // One job per type and range, so re-planning is idempotent.
    uniqueIndex("sync_jobs_range_uq").on(t.userId, t.dataType, t.rangeFrom, t.rangeTo),
    ownerReadPolicy("sync_jobs"),
  ],
).enableRLS();

/** Landing zone for every Garmin response (kept 30 days), for replay and debugging. */
export const rawIngest = pgTable(
  "raw_ingest",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: userId(),
    source: text("source").notNull().default("garmin"),
    endpoint: text("endpoint").notNull(),
    rangeFrom: timestamp("range_from", { withTimezone: true }),
    rangeTo: timestamp("range_to", { withTimezone: true }),
    payload: jsonb("payload").notNull(),
    sha256: text("sha256").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [
    index("raw_ingest_received_idx").on(t.receivedAt),
    index("raw_ingest_unprocessed_idx").on(t.userId).where(sql`processed_at is null`),
    // Skip storing an identical response twice (re-fetched overlap days).
    index("raw_ingest_dedupe_idx").on(t.userId, t.endpoint, t.sha256),
    ownerReadPolicy("raw_ingest"),
  ],
).enableRLS();
