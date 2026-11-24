/**
 * Imports against a local Supabase database: precedence between the Garmin
 * API, the Garmin account export and Apple Health, and idempotent re-imports.
 * Run with: pnpm test:rls (needs `pnpm exec supabase start`).
 */
import { randomUUID } from "node:crypto";
import { createDb, schema } from "@ft/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { importBatch, type ImportBatch } from "@/lib/import/rows";
import { importRows, supersedeApple, supersedeExportSleep } from "@/server/imports";

const DB_URL = process.env.RLS_TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const db = createDb(DB_URL);
const USER = randomUUID();

const rows = async (q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as Array<Record<string, unknown>>;
const parsed = (b: ImportBatch) => importBatch.parse(b);

beforeAll(async () => {
  await db.execute(sql`insert into auth.users (id, email, aud, role) values (${USER}::uuid, ${`imp-${USER}@example.test`}, 'authenticated', 'authenticated')`);
  // The Garmin API already stored 2 March (day, night and a run).
  await db.insert(schema.dailySummaries).values({ userId: USER, localDate: "2023-03-02", source: "garmin", steps: 11_111 });
  await db.insert(schema.sleepSessions).values({
    userId: USER,
    source: "garmin",
    sourceRecordId: "1677712200000",
    localDate: "2023-03-02",
    startTime: new Date("2023-03-01T23:10:00Z"),
    endTime: new Date("2023-03-02T06:40:00Z"),
    totalSleepS: 27_000,
  });
  await db.insert(schema.activities).values({
    userId: USER,
    source: "garmin",
    sourceRecordId: "4370000001",
    sport: "running",
    startTime: new Date("2023-03-02T08:00:00Z"),
    localDate: "2023-03-02",
    distanceM: 5000,
  });
});

afterAll(async () => {
  await db.execute(sql`delete from auth.users where id = ${USER}::uuid`);
  await db.$client.end();
});

describe("Garmin account export", () => {
  it("never overwrites the API's day, night or activity, and fills older ones", async () => {
    const daily = await importRows(db, USER, "garmin_export", parsed({ kind: "daily", rows: [{ localDate: "2023-03-02", steps: 1 }, { localDate: "2023-03-01", steps: 9000 }] }));
    expect(daily).toEqual({ written: 1, superseded: 1 });

    const sleep = await importRows(
      db,
      USER,
      "garmin_export",
      parsed({
        kind: "sleep",
        rows: [
          { sourceRecordId: "export-2023-03-02", localDate: "2023-03-02", startTime: "2023-03-01T23:10:00.000Z", endTime: "2023-03-02T06:40:00.000Z" },
          { sourceRecordId: "export-2023-03-01", localDate: "2023-03-01", startTime: "2023-02-28T23:00:00.000Z", endTime: "2023-03-01T07:00:00.000Z", totalSleepS: 25_000 },
        ],
      }),
    );
    expect(sleep).toEqual({ written: 1, superseded: 1 });

    const act = await importRows(
      db,
      USER,
      "garmin_export",
      parsed({
        kind: "activities",
        rows: [
          { sourceRecordId: "4370000001", sport: "running", startTime: "2023-03-02T08:00:00.000Z", localDate: "2023-03-02", distanceM: 1 },
          { sourceRecordId: "4360000000", sport: "cycling", startTime: "2023-02-20T08:00:00.000Z", localDate: "2023-02-20", distanceM: 30_000 },
        ],
      }),
    );
    expect(act).toEqual({ written: 1, superseded: 1 });

    const [d] = await rows(sql`select steps from daily_summaries where user_id = ${USER}::uuid and local_date = '2023-03-02'`);
    expect(d!.steps).toBe(11_111);
    const [a] = await rows(sql`select distance_m from activities where user_id = ${USER}::uuid and source_record_id = '4370000001'`);
    expect(a!.distance_m).toBe(5000);
    // Over a year old: marked as fetched so no file download is queued.
    const [old] = await rows(sql`select file_fetched_at from activities where user_id = ${USER}::uuid and source_record_id = '4360000000'`);
    expect(old!.file_fetched_at).not.toBeNull();
  });

  it("is idempotent", async () => {
    const again = await importRows(db, USER, "garmin_export", parsed({ kind: "daily", rows: [{ localDate: "2023-03-01", steps: 9000 }] }));
    expect(again.written).toBe(0);
    const [n] = await rows(sql`select count(*)::int as n from daily_summaries where user_id = ${USER}::uuid`);
    expect(n!.n).toBe(2);
  });

  it("the API's night replaces the export's copy when it arrives", async () => {
    await supersedeExportSleep(db, USER, ["2023-03-01"]);
    const [n] = await rows(sql`select count(*)::int as n from sleep_sessions where user_id = ${USER}::uuid and source_record_id like 'export-%'`);
    expect(n!.n).toBe(0);
  });
});

describe("Apple Health", () => {
  it("only fills days, nights and workouts Garmin doesn't have", async () => {
    const daily = await importRows(db, USER, "apple_health", parsed({ kind: "daily", rows: [{ localDate: "2023-03-02", steps: 5 }, { localDate: "2023-03-10", steps: 7000 }] }));
    expect(daily).toEqual({ written: 1, superseded: 1 });

    const act = await importRows(
      db,
      USER,
      "apple_health",
      parsed({
        kind: "activities",
        rows: [
          // The same run, recorded by the Watch a few minutes apart.
          { sourceRecordId: "apple-a", sport: "running", startTime: "2023-03-02T08:04:00.000Z", localDate: "2023-03-02" },
          { sourceRecordId: "apple-b", sport: "walking", startTime: "2023-03-10T12:00:00.000Z", localDate: "2023-03-10" },
        ],
      }),
    );
    expect(act).toEqual({ written: 1, superseded: 1 });

    const w = await importRows(db, USER, "apple_health", parsed({ kind: "weight", rows: [{ localDate: "2023-03-10", weightKg: 80.2 }] }));
    expect(w.written).toBe(1);
    // Re-import updates in place.
    await importRows(db, USER, "apple_health", parsed({ kind: "daily", rows: [{ localDate: "2023-03-10", steps: 7100 }] }));
    const [d] = await rows(sql`select steps, source from daily_summaries where user_id = ${USER}::uuid and local_date = '2023-03-10'`);
    expect(d).toEqual({ steps: 7100, source: "apple_health" });
  });

  it("keeps sleep stages only for nights stored from Apple Health, replacing a night as a whole", async () => {
    await importRows(
      db,
      USER,
      "apple_health",
      parsed({ kind: "sleep", rows: [{ sourceRecordId: "apple-sleep-2023-03-11", localDate: "2023-03-11", startTime: "2023-03-10T23:00:00.000Z", endTime: "2023-03-11T07:00:00.000Z", totalSleepS: 27_000 }] }),
    );
    const stage = (date: string, start: string, end: string, s: "light" | "deep" | "awake") => ({ localDate: date, start, end, stage: s });
    const first = await importRows(
      db,
      USER,
      "apple_health",
      parsed({
        kind: "sleep_stages",
        rows: [
          stage("2023-03-11", "2023-03-10T23:00:00.000Z", "2023-03-11T02:00:00.000Z", "light"),
          stage("2023-03-11", "2023-03-11T02:00:00.000Z", "2023-03-11T07:00:00.000Z", "deep"),
          // 2 March is Garmin's night: its Apple stages are dropped.
          stage("2023-03-02", "2023-03-01T23:00:00.000Z", "2023-03-02T06:00:00.000Z", "light"),
        ],
      }),
    );
    expect(first).toEqual({ written: 2, superseded: 1 });
    // Re-import with different stages replaces the night.
    await importRows(db, USER, "apple_health", parsed({ kind: "sleep_stages", rows: [stage("2023-03-11", "2023-03-10T23:30:00.000Z", "2023-03-11T07:00:00.000Z", "light")] }));
    const rowsNow = await rows(sql`select stage from sleep_stages where user_id = ${USER}::uuid and local_date = '2023-03-11'`);
    expect(rowsNow).toEqual([{ stage: "light" }]);

    // Garmin's night arriving removes Apple's night and its stages.
    await supersedeApple(db, USER, "sleep", ["2023-03-11"]);
    const [n] = await rows(sql`select count(*)::int as n from sleep_stages where user_id = ${USER}::uuid`);
    expect(n!.n).toBe(0);
  });

  it("Garmin data arriving later removes the Apple copy", async () => {
    await db.insert(schema.dailySummaries).values({ userId: USER, localDate: "2023-03-10", source: "garmin", steps: 7300 });
    await supersedeApple(db, USER, "daily", ["2023-03-10"]);
    await supersedeApple(db, USER, "activities", [Date.parse("2023-03-10T12:03:00Z")]);
    const left = await rows(sql`select source from daily_summaries where user_id = ${USER}::uuid and local_date = '2023-03-10'`);
    expect(left).toEqual([{ source: "garmin" }]);
    const [n] = await rows(sql`select count(*)::int as n from activities where user_id = ${USER}::uuid and source = 'apple_health'`);
    expect(n!.n).toBe(0);
  });
});
