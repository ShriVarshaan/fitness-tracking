import "server-only";
import { addDays, localDate } from "@ft/core";
import { schema, type Db } from "@ft/db";
import { and, eq, getTableColumns, gte, inArray, like, lte, ne, notLike, sql, type Column, type SQL, type Table } from "drizzle-orm";
import type { z } from "zod";
import type { ImportSource, importBatch } from "@/lib/import/rows";

const { activities, bodyMeasurements, dailySummaries, sleepSessions, sleepStages, vo2maxDaily } = schema;

/**
 * Imports from export files (docs/adr/0003-imports.md). Precedence, so each day
 * has one source per table and readers never add two together:
 *   Garmin Personal API > Garmin account export > Apple Health.
 * Garmin export rows are Garmin's data and use source "garmin" on the same keys
 * as the API (activities by id, days by date); the API's rows win on conflict.
 * Apple Health rows use source "apple_health" and only fill days, nights and
 * workouts that Garmin doesn't have.
 */

export type ParsedBatch = z.output<typeof importBatch>;

/** Canonical `source` stored for each import. */
export const STORED_SOURCE: Record<ImportSource, string> = { garmin_export: "garmin", apple_health: "apple_health" };

/** Imported Garmin activities older than this get no file download (database budget). */
const FILE_DOWNLOAD_DAYS = 365;
/** Two activities starting this close together are the same session recorded twice. */
const SAME_ACTIVITY_MS = 10 * 60_000;

function excludedSet(table: Table, keys: string[]): Record<string, SQL> {
  const columns = getTableColumns(table) as Record<string, Column>;
  return Object.fromEntries(keys.map((k) => [k, sql`excluded.${sql.identifier(columns[k]!.name)}`]));
}

const dates = (rows: Array<{ localDate: string }>) => [...new Set(rows.map((r) => r.localDate))];

export interface BatchResult {
  written: number;
  /** Rows not written because a higher-precedence source already has that day or session. */
  superseded: number;
}

export async function importRows(db: Db, userId: string, source: ImportSource, batch: ParsedBatch): Promise<BatchResult> {
  const stored = STORED_SOURCE[source];
  const base = { userId, source: stored, ingestedAt: new Date() };
  const isGarmin = source === "garmin_export";

  switch (batch.kind) {
    case "daily": {
      let rows = batch.rows;
      if (!isGarmin) {
        const taken = await db
          .select({ d: dailySummaries.localDate })
          .from(dailySummaries)
          .where(and(eq(dailySummaries.userId, userId), ne(dailySummaries.source, stored), inArray(dailySummaries.localDate, dates(rows))));
        const skip = new Set(taken.map((t) => t.d));
        rows = rows.filter((r) => !skip.has(r.localDate));
      }
      if (!rows.length) return { written: 0, superseded: batch.rows.length };
      const q = db.insert(dailySummaries).values(rows.map((r) => ({ ...base, ...r })));
      const cols = Object.keys(rows[0]!).filter((k) => k !== "localDate");
      // Garmin export: the API's row for the same day is fresher, so never overwrite it.
      const res = isGarmin
        ? await q.onConflictDoNothing().returning({ d: dailySummaries.localDate })
        : await q
            .onConflictDoUpdate({ target: [dailySummaries.userId, dailySummaries.localDate, dailySummaries.source], set: excludedSet(dailySummaries, [...cols, "ingestedAt"]) })
            .returning({ d: dailySummaries.localDate });
      if (isGarmin) await supersedeApple(db, userId, "daily", res.map((r) => r.d));
      return { written: res.length, superseded: batch.rows.length - res.length };
    }

    case "sleep": {
      // A night the Garmin API stored wins over the export's copy; Garmin (either way) wins over Apple.
      const taken = await db
        .select({ d: sleepSessions.localDate })
        .from(sleepSessions)
        .where(
          and(
            eq(sleepSessions.userId, userId),
            inArray(sleepSessions.localDate, dates(batch.rows)),
            isGarmin ? and(eq(sleepSessions.source, "garmin"), notLike(sleepSessions.sourceRecordId, "export-%")) : ne(sleepSessions.source, stored),
          ),
        );
      const skip = new Set(taken.map((t) => t.d));
      const rows = batch.rows.filter((r) => !skip.has(r.localDate));
      if (!rows.length) return { written: 0, superseded: batch.rows.length };
      const cols = Object.keys(rows[0]!).filter((k) => k !== "sourceRecordId");
      await db
        .insert(sleepSessions)
        .values(rows.map((r) => ({ ...base, ...r, startTime: new Date(r.startTime), endTime: new Date(r.endTime) })))
        .onConflictDoUpdate({ target: [sleepSessions.userId, sleepSessions.source, sleepSessions.sourceRecordId], set: excludedSet(sleepSessions, [...cols, "ingestedAt"]) });
      if (isGarmin) await supersedeApple(db, userId, "sleep", dates(rows));
      return { written: rows.length, superseded: batch.rows.length - rows.length };
    }

    case "activities": {
      let rows = batch.rows;
      if (!isGarmin) {
        const others = await nearbyActivities(db, userId, rows.map((r) => Date.parse(r.startTime)), ne(activities.source, stored));
        rows = rows.filter((r) => !others.some((t) => Math.abs(t - Date.parse(r.startTime)) < SAME_ACTIVITY_MS));
      }
      if (!rows.length) return { written: 0, superseded: batch.rows.length };
      const cutoff = addDays(localDate(new Date(), 0), -FILE_DOWNLOAD_DAYS);
      const values = rows.map((r) => ({
        ...base,
        ...r,
        startTime: new Date(r.startTime),
        // Apple has no activity file; old Garmin ones are left without one to protect the database budget.
        fileFetchedAt: !isGarmin || r.localDate < cutoff ? new Date() : null,
      }));
      const q = db.insert(activities).values(values);
      const cols = Object.keys(rows[0]!).filter((k) => k !== "sourceRecordId");
      const res = isGarmin
        ? await q.onConflictDoNothing().returning({ t: activities.startTime })
        : await q
            .onConflictDoUpdate({ target: [activities.userId, activities.source, activities.sourceRecordId], set: excludedSet(activities, [...cols, "ingestedAt"]) })
            .returning({ t: activities.startTime });
      if (isGarmin) await supersedeApple(db, userId, "activities", res.map((r) => r.t.getTime()));
      return { written: res.length, superseded: batch.rows.length - res.length };
    }

    case "sleep_stages": {
      // Apple only: stages for nights stored from Apple Health (not ones Garmin has). Batches hold whole nights.
      const nights = dates(batch.rows);
      if (!nights.length) return { written: 0, superseded: 0 };
      const kept = await db
        .select({ d: sleepSessions.localDate })
        .from(sleepSessions)
        .where(and(eq(sleepSessions.userId, userId), eq(sleepSessions.source, stored), inArray(sleepSessions.localDate, nights)));
      const keep = new Set(kept.map((k) => k.d));
      const rows = batch.rows.filter((r) => keep.has(r.localDate));
      await db.transaction(async (tx) => {
        if (keep.size) {
          await tx.delete(sleepStages).where(and(eq(sleepStages.userId, userId), eq(sleepStages.source, stored), inArray(sleepStages.localDate, [...keep])));
        }
        if (rows.length) {
          await tx
            .insert(sleepStages)
            .values(rows.map((r) => ({ userId, source: stored, localDate: r.localDate, startTime: new Date(r.start), endTime: new Date(r.end), stage: r.stage })))
            .onConflictDoNothing();
        }
      });
      return { written: rows.length, superseded: batch.rows.length - rows.length };
    }

    case "weight": {
      if (!batch.rows.length) return { written: 0, superseded: 0 };
      // Weights keep every source; readers pick one per day (yours, then Garmin, then Apple).
      await db
        .insert(bodyMeasurements)
        .values(batch.rows.map((r) => ({ userId, source: stored, ...r, updatedAt: new Date() })))
        .onConflictDoUpdate({
          target: [bodyMeasurements.userId, bodyMeasurements.localDate, bodyMeasurements.source],
          set: excludedSet(bodyMeasurements, ["weightKg", "bodyFatPct", "updatedAt"]),
        });
      return { written: batch.rows.length, superseded: 0 };
    }

    case "vo2max": {
      const taken = await db
        .select({ d: vo2maxDaily.localDate, sport: vo2maxDaily.sport })
        .from(vo2maxDaily)
        .where(and(eq(vo2maxDaily.userId, userId), ne(vo2maxDaily.source, stored), inArray(vo2maxDaily.localDate, dates(batch.rows))));
      const skip = new Set(taken.map((t) => `${t.d}|${t.sport}`));
      const rows = batch.rows.filter((r) => !skip.has(`${r.localDate}|${r.sport}`));
      if (!rows.length) return { written: 0, superseded: batch.rows.length };
      await db
        .insert(vo2maxDaily)
        .values(rows.map((r) => ({ ...base, ...r })))
        .onConflictDoUpdate({ target: [vo2maxDaily.userId, vo2maxDaily.localDate, vo2maxDaily.sport, vo2maxDaily.source], set: excludedSet(vo2maxDaily, ["value", "ingestedAt"]) });
      return { written: rows.length, superseded: batch.rows.length - rows.length };
    }
  }
}

/** Start times of the user's activities near any of the given instants, matching `where`. */
async function nearbyActivities(db: Db, userId: string, instants: number[], where: SQL | undefined): Promise<number[]> {
  if (!instants.length) return [];
  const lo = new Date(Math.min(...instants) - SAME_ACTIVITY_MS);
  const hi = new Date(Math.max(...instants) + SAME_ACTIVITY_MS);
  const rows = await db
    .select({ t: activities.startTime })
    .from(activities)
    .where(and(eq(activities.userId, userId), gte(activities.startTime, lo), lte(activities.startTime, hi), where));
  return rows.map((r) => r.t.getTime());
}

/**
 * Garmin data arrived (from the API or the account export): remove Apple
 * Health rows for the same days, nights or sessions, and, for API sleep,
 * the export's copy of that night.
 */
export async function supersedeApple(db: Db, userId: string, kind: "daily" | "sleep" | "activities" | "vo2max", keys: Array<string | number>): Promise<void> {
  if (!keys.length) return;
  if (kind === "vo2max") {
    await db.delete(vo2maxDaily).where(and(eq(vo2maxDaily.userId, userId), eq(vo2maxDaily.source, "apple_health"), inArray(vo2maxDaily.localDate, keys as string[])));
  } else if (kind === "daily") {
    await db.delete(dailySummaries).where(and(eq(dailySummaries.userId, userId), eq(dailySummaries.source, "apple_health"), inArray(dailySummaries.localDate, keys as string[])));
  } else if (kind === "sleep") {
    await db.delete(sleepSessions).where(and(eq(sleepSessions.userId, userId), eq(sleepSessions.source, "apple_health"), inArray(sleepSessions.localDate, keys as string[])));
    await db.delete(sleepStages).where(and(eq(sleepStages.userId, userId), eq(sleepStages.source, "apple_health"), inArray(sleepStages.localDate, keys as string[])));
  } else {
    const instants = keys as number[];
    const lo = new Date(Math.min(...instants) - SAME_ACTIVITY_MS);
    const hi = new Date(Math.max(...instants) + SAME_ACTIVITY_MS);
    const apple = await db
      .select({ id: activities.sourceRecordId, t: activities.startTime })
      .from(activities)
      .where(and(eq(activities.userId, userId), eq(activities.source, "apple_health"), gte(activities.startTime, lo), lte(activities.startTime, hi)));
    const dupes = apple.filter((a) => instants.some((t) => Math.abs(t - a.t.getTime()) < SAME_ACTIVITY_MS)).map((a) => a.id!);
    if (dupes.length) {
      await db.delete(activities).where(and(eq(activities.userId, userId), eq(activities.source, "apple_health"), inArray(activities.sourceRecordId, dupes)));
    }
  }
}

/** The Garmin API stored these nights: drop the account export's copies of them. */
export async function supersedeExportSleep(db: Db, userId: string, nights: string[]): Promise<void> {
  if (!nights.length) return;
  await db
    .delete(sleepSessions)
    .where(and(eq(sleepSessions.userId, userId), eq(sleepSessions.source, "garmin"), like(sleepSessions.sourceRecordId, "export-%"), inArray(sleepSessions.localDate, nights)));
}

/** What an import has stored so far, per source (for the Settings page). */
export async function importedCounts(db: Db, userId: string): Promise<Record<"apple_health", { days: number; nights: number; activities: number }>> {
  const count = async (table: typeof dailySummaries | typeof sleepSessions | typeof activities) =>
    (await db.select({ n: sql<number>`count(*)::int` }).from(table).where(and(eq(table.userId, userId), eq(table.source, "apple_health"))))[0]?.n ?? 0;
  return { apple_health: { days: await count(dailySummaries), nights: await count(sleepSessions), activities: await count(activities) } };
}

/** Remove everything an Apple Health import stored. */
export async function deleteAppleHealth(db: Db, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    for (const table of [dailySummaries, sleepSessions, sleepStages, activities, vo2maxDaily, bodyMeasurements] as const) {
      await tx.delete(table).where(and(eq(table.userId, userId), eq(table.source, "apple_health")));
    }
  });
}
