/**
 * End-to-end against a local Supabase database: demo data → derived metrics →
 * rules → morning insight, then removal leaves nothing behind.
 * Run with: pnpm test:rls (needs `pnpm exec supabase start`).
 */
import { randomUUID } from "node:crypto";
import { createDb } from "@ft/db";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadDemoData, removeDemoData } from "@/server/demo";
import { recomputeDerived } from "@/server/derive";

const DB_URL = process.env.RLS_TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const db = createDb(DB_URL);
const USER = randomUUID();

const count = async (table: string) =>
  Number((await db.execute<{ n: number }>(sql`select count(*)::int as n from ${sql.identifier(table)} where user_id = ${USER}::uuid`))[0]!.n);

beforeAll(async () => {
  await db.execute(sql`insert into auth.users (id, email, aud, role) values (${USER}::uuid, ${`demo-${USER}@example.test`}, 'authenticated', 'authenticated')`);
});

afterAll(async () => {
  await db.execute(sql`delete from auth.users where id = ${USER}::uuid`);
  await db.$client.end();
});

describe("demo data end to end", () => {
  it("loads 120 days and produces estimates, findings and a validated insight", async () => {
    expect(await loadDemoData(db, USER)).toEqual({ ok: true });

    expect(await count("daily_summaries")).toBe(120);
    expect(await count("sleep_sessions")).toBe(120);
    expect(await count("hrv_daily")).toBe(120);
    expect(await count("activities")).toBeGreaterThan(40);
    expect(await count("derived_daily")).toBe(120 * 9);
    expect(await count("findings")).toBeGreaterThan(0);

    const [insight] = await db.execute<{ validator_ok: boolean; headline: string }>(
      sql`select validator_ok, body->>'headline' as headline from insights where user_id = ${USER}::uuid`,
    );
    expect(insight?.validator_ok).toBe(true);
    expect(insight?.headline).toBeTruthy();

    // The rough week should have triggered at least one caution.
    const [cautions] = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from findings where user_id = ${USER}::uuid and severity = 'caution'`,
    );
    expect(cautions!.n).toBeGreaterThan(0);
  });

  it("reloading replaces rather than duplicates", async () => {
    await loadDemoData(db, USER);
    expect(await count("daily_summaries")).toBe(120);
  });

  it("removal clears data, estimates, findings and insights", async () => {
    await removeDemoData(db, USER);
    await recomputeDerived(db, USER);
    for (const t of ["daily_summaries", "sleep_sessions", "hrv_daily", "activities", "derived_daily", "findings", "insights"]) {
      expect(await count(t), t).toBe(0);
    }
  });

  it("refuses demo data while Garmin is connected", async () => {
    await db.execute(sql`insert into garmin_connection (user_id, status) values (${USER}::uuid, 'active')`);
    expect(await loadDemoData(db, USER)).toEqual({ ok: false, reason: "garmin_connected" });
    await db.execute(sql`delete from garmin_connection where user_id = ${USER}::uuid`);
  });
});
