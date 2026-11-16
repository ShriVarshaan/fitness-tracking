import "server-only";
import { schema, type Db } from "@ft/db";
import { isEmptyPayload, mapActivities, mapDailySummaries, mapHrv, mapSleepSummaries, mapVo2max } from "@ft/garmin";
import { and, asc, eq, getTableColumns, isNull, sql, type Column, type SQL, type Table } from "drizzle-orm";
import { ZodError } from "zod";

const { rawIngest, dailySummaries, sleepSessions, hrvDaily, activities, vo2maxDaily } = schema;

type RawRow = typeof rawIngest.$inferSelect;

/** Upsert helper: on conflict, overwrite the given columns with the incoming values. */
function excludedSet(table: Table, keys: string[]): Record<string, SQL> {
  const columns = getTableColumns(table) as Record<string, Column>;
  return Object.fromEntries(
    keys.map((k) => {
      const column = columns[k];
      if (!column) throw new Error(`unknown column ${k}`);
      return [k, sql`excluded.${sql.identifier(column.name)}`];
    }),
  );
}

async function mapRow(db: Db, row: RawRow): Promise<void> {
  const base = { userId: row.userId, source: "garmin", rawIngestId: row.id, ingestedAt: new Date() };

  switch (row.endpoint) {
    case "dailysummaries": {
      const rows = mapDailySummaries(row.payload);
      if (rows.length === 0) return;
      const cols = Object.keys(rows[0]!).filter((k) => k !== "localDate");
      await db
        .insert(dailySummaries)
        .values(rows.map((r) => ({ ...base, ...r })))
        .onConflictDoUpdate({
          target: [dailySummaries.userId, dailySummaries.localDate, dailySummaries.source],
          set: excludedSet(dailySummaries, [...cols, "rawIngestId", "ingestedAt"]),
        });
      return;
    }
    case "sleep_summaries": {
      const rows = mapSleepSummaries(row.payload);
      if (rows.length === 0) return;
      const cols = Object.keys(rows[0]!).filter((k) => k !== "sourceRecordId");
      await db
        .insert(sleepSessions)
        .values(rows.map((r) => ({ ...base, ...r })))
        .onConflictDoUpdate({
          target: [sleepSessions.userId, sleepSessions.source, sleepSessions.sourceRecordId],
          set: excludedSet(sleepSessions, [...cols, "rawIngestId", "ingestedAt"]),
        });
      return;
    }
    case "hrv_daily": {
      const rows = mapHrv(row.payload);
      if (rows.length === 0) return;
      const cols = Object.keys(rows[0]!).filter((k) => k !== "localDate");
      await db
        .insert(hrvDaily)
        .values(rows.map((r) => ({ ...base, ...r })))
        .onConflictDoUpdate({
          target: [hrvDaily.userId, hrvDaily.localDate, hrvDaily.source],
          set: excludedSet(hrvDaily, [...cols, "rawIngestId", "ingestedAt"]),
        });
      return;
    }
    case "activities_search": {
      const rows = mapActivities(row.payload);
      if (rows.length === 0) return;
      const cols = Object.keys(rows[0]!).filter((k) => k !== "sourceRecordId");
      await db
        .insert(activities)
        .values(rows.map((r) => ({ ...base, ...r })))
        .onConflictDoUpdate({
          target: [activities.userId, activities.source, activities.sourceRecordId],
          set: excludedSet(activities, [...cols, "rawIngestId", "ingestedAt"]),
        });
      return;
    }
    case "vo2max_daily": {
      const rows = mapVo2max(row.payload);
      if (rows.length === 0) return;
      await db
        .insert(vo2maxDaily)
        .values(rows.map((r) => ({ ...base, ...r })))
        .onConflictDoUpdate({
          target: [vo2maxDaily.userId, vo2maxDaily.localDate, vo2maxDaily.sport, vo2maxDaily.source],
          set: excludedSet(vo2maxDaily, ["value", "rawIngestId", "ingestedAt"]),
        });
      return;
    }
    default:
      // No mapper yet (weight): empty responses are simply done;
      // anything with data is kept raw and flagged so a mapper can be written for it.
      if (!isEmptyPayload(row.payload)) throw new UnmappedError(row.endpoint);
  }
}

class UnmappedError extends Error {
  constructor(endpoint: string) {
    super(`unmapped: no mapper for ${endpoint} yet`);
  }
}

export interface ProcessResult {
  processed: number;
  quarantined: number;
  /** Users who received new canonical rows (their derived metrics need recomputing). */
  touchedUsers: string[];
}

/**
 * Turn stored Garmin responses into canonical rows, oldest first. A response
 * that fails validation is quarantined (error set, payload kept) and skipped.
 */
export async function processPending(db: Db, opts: { userId?: string; budgetMs: number; limit?: number }): Promise<ProcessResult> {
  const started = Date.now();
  const result: ProcessResult = { processed: 0, quarantined: 0, touchedUsers: [] };
  const touched = new Set<string>();
  const rows = await db
    .select()
    .from(rawIngest)
    .where(
      and(isNull(rawIngest.processedAt), isNull(rawIngest.error), opts.userId ? eq(rawIngest.userId, opts.userId) : undefined),
    )
    .orderBy(asc(rawIngest.id))
    .limit(opts.limit ?? 200);

  for (const row of rows) {
    if (Date.now() - started > opts.budgetMs) break;
    try {
      await mapRow(db, row);
      await db.update(rawIngest).set({ processedAt: new Date() }).where(eq(rawIngest.id, row.id));
      result.processed++;
      touched.add(row.userId);
    } catch (err) {
      const message =
        err instanceof ZodError
          ? `schema: ${err.issues
              .slice(0, 3)
              .map((i) => `${i.path.join(".")} ${i.message}`)
              .join("; ")}`
          : err instanceof Error
            ? err.message
            : "unknown error";
      await db.update(rawIngest).set({ error: message.slice(0, 500) }).where(eq(rawIngest.id, row.id));
      result.quarantined++;
    }
  }
  result.touchedUsers = [...touched];
  return result;
}
