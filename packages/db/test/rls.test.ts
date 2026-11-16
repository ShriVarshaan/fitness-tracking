/**
 * Row-level security tests against a local Supabase stack (`supabase start`).
 * They act as the `anon` and `authenticated` roles exactly as PostgREST does:
 * SET ROLE plus request.jwt.claims, so auth.uid() resolves to the test user.
 *
 * Run with: pnpm test:rls   (needs Docker and `pnpm exec supabase start`)
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_URL = process.env.RLS_TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });

const A = randomUUID();
const B = randomUUID();

/** Tables that hold per-user data, with a minimal valid row for user A. */
const SEED: Record<string, (u: string) => postgres.PendingQuery<postgres.Row[]>> = {
  profile: (u) => sql`insert into profile (user_id) values (${u})`,
  user_physiology: (u) => sql`insert into user_physiology (user_id, hr_max) values (${u}, 190)`,
  garmin_connection: (u) => sql`insert into garmin_connection (user_id) values (${u})`,
  sync_jobs: (u) =>
    sql`insert into sync_jobs (user_id, kind, data_type, range_from, range_to) values (${u}, 'backfill', 'sleep', now(), now())`,
  raw_ingest: (u) => sql`insert into raw_ingest (user_id, endpoint, payload, sha256) values (${u}, 'x', '{}'::jsonb, 'h')`,
  daily_summaries: (u) => sql`insert into daily_summaries (user_id, local_date, steps) values (${u}, '2026-01-01', 1000)`,
  sleep_sessions: (u) =>
    sql`insert into sleep_sessions (user_id, local_date, start_time, end_time, source_record_id) values (${u}, '2026-01-01', now(), now(), 's1')`,
  hrv_daily: (u) => sql`insert into hrv_daily (user_id, local_date, last_night_avg_ms) values (${u}, '2026-01-01', 60)`,
  activities: (u) =>
    sql`insert into activities (user_id, sport, start_time, local_date, source_record_id) values (${u}, 'running', now(), '2026-01-01', 'a1')`,
  vo2max_daily: (u) => sql`insert into vo2max_daily (user_id, local_date, sport, value) values (${u}, '2026-01-01', 'running', 45)`,
  derived_daily: (u) =>
    sql`insert into derived_daily (user_id, local_date, metric_code, value, algo_version, inputs_hash) values (${u}, '2026-01-01', 'readiness', 60, 1, 'h')`,
  findings: (u) =>
    sql`insert into findings (user_id, local_date, rule_id, rule_version, severity, confidence, evidence) values (${u}, '2026-01-01', 'R', 1, 'info', 1, '[]'::jsonb)`,
  insights: (u) =>
    sql`insert into insights (user_id, kind, for_date, body, rule_ids, model, validator_ok) values (${u}, 'morning', '2026-01-01', '{}'::jsonb, '{}', 'template', true)`,
};

/** Tables users may only read; all writes go through server code. */
const SERVER_WRITE_ONLY = [
  "garmin_connection",
  "sync_jobs",
  "raw_ingest",
  "daily_summaries",
  "sleep_sessions",
  "hrv_daily",
  "activities",
  "vo2max_daily",
  "derived_daily",
  "findings",
  "insights",
];

/** Run `fn` as a PostgREST role inside a transaction that is always rolled back. */
async function as<T>(role: "anon" | "authenticated", userId: string | null, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  let result!: T;
  await sql
    .begin(async (tx) => {
      const claims = userId ? { sub: userId, role } : { role };
      await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
      await tx.unsafe(`set local role ${role}`);
      result = await fn(tx);
      throw new RollBack();
    })
    .catch((e) => {
      if (!(e instanceof RollBack)) throw e;
    });
  return result;
}
class RollBack extends Error {}

const count = async (tx: postgres.TransactionSql, table: string) =>
  Number((await tx.unsafe(`select count(*)::int as n from public.${table}`))[0]!.n);

beforeAll(async () => {
  for (const [id, email] of [
    [A, `rls-a-${A}@example.test`],
    [B, `rls-b-${B}@example.test`],
  ] as const) {
    await sql`insert into auth.users (id, email, aud, role) values (${id}, ${email}, 'authenticated', 'authenticated')`;
  }
  for (const seed of Object.values(SEED)) await seed(A);
});

afterAll(async () => {
  // Cascades remove every seeded row.
  await sql`delete from auth.users where id in (${A}, ${B})`;
  await sql.end();
});

describe("RLS coverage", () => {
  it("is enabled on every table in the public schema", async () => {
    const rows = await sql`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`;
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it("seeds every public table that has a user_id column", async () => {
    const rows = await sql`
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'user_id'`;
    expect(rows.map((r) => r.table_name).sort()).toEqual(Object.keys(SEED).sort());
  });
});

describe("isolation between users", () => {
  for (const table of Object.keys(SEED)) {
    it(`${table}: owner sees their row, another user and anon see nothing`, async () => {
      expect(await as("authenticated", A, (tx) => count(tx, table))).toBe(1);
      expect(await as("authenticated", B, (tx) => count(tx, table))).toBe(0);
      expect(await as("anon", null, (tx) => count(tx, table))).toBe(0);
    });
  }

  it("another user cannot update or delete the owner's profile", async () => {
    const updated = await as("authenticated", B, (tx) => tx`update profile set display_name = 'x' where user_id = ${A} returning user_id`);
    const deleted = await as("authenticated", B, (tx) => tx`delete from profile where user_id = ${A} returning user_id`);
    expect(updated).toHaveLength(0);
    expect(deleted).toHaveLength(0);
  });

  it("a user cannot create a profile row for someone else", async () => {
    await expect(as("authenticated", B, (tx) => tx`insert into profile (user_id) values (${A})`)).rejects.toThrow(
      /row-level security|duplicate key/,
    );
  });
});

describe("server-only writes", () => {
  for (const table of SERVER_WRITE_ONLY) {
    it(`${table}: the owner cannot insert, update or delete`, async () => {
      const updated = await as("authenticated", A, (tx) => tx.unsafe(`update public.${table} set user_id = user_id returning 1`));
      const deleted = await as("authenticated", A, (tx) => tx.unsafe(`delete from public.${table} returning 1`));
      expect(updated).toHaveLength(0);
      expect(deleted).toHaveLength(0);
    });
  }

  it("the owner cannot queue their own sync jobs", async () => {
    await expect(
      as("authenticated", A, (tx) => tx`insert into sync_jobs (user_id, kind, data_type, range_from, range_to) values (${A}, 'backfill', 'hrv', now(), now())`),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("secrets", () => {
  it("users cannot call the Vault helper functions", async () => {
    for (const role of ["anon", "authenticated"] as const) {
      await expect(as(role, role === "anon" ? null : A, (tx) => tx`select private.get_secret('garmin_api_key:x')`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(as(role, role === "anon" ? null : A, (tx) => tx`select private.set_secret('x', 'y')`)).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it("users cannot read Vault directly", async () => {
    await expect(as("authenticated", A, (tx) => tx`select * from vault.decrypted_secrets`)).rejects.toThrow(/permission denied/);
  });
});
