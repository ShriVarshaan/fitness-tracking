import "server-only";
import { createHash } from "node:crypto";
import { localDate } from "@ft/core";
import { schema, type Db } from "@ft/db";
import {
  ALL_DATA_TYPES,
  DATA_TYPES,
  exchangeKey,
  fetchJob,
  GarminAuthError,
  GarminClient,
  GarminRateLimitError,
  needsRenewal,
  planBackfill,
  planIncremental,
  type DataType,
  type PlannedJob,
} from "@ft/garmin";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { deleteSecret, getSecret, secretName, setSecret } from "./secrets";

const { garminConnection, rawIngest, syncJobs } = schema;

/** Re-plan incremental jobs at most this often per user. */
const REPLAN_EVERY_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 5;
/** A job "running" longer than this was cut off (function timeout) and is retried. */
const STALE_LOCK_MS = 5 * 60 * 1000;

const today = () => localDate(new Date(), 0);
const toInstant = (d: string) => new Date(`${d}T00:00:00Z`);
const toDate = (t: Date) => t.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------------
// Connect / disconnect
// ---------------------------------------------------------------------------------

export type ConnectResult = { ok: true } | { ok: false; reason: "rejected" | "rate_limited" | "unavailable" };

/** Check the key with Garmin, store it in Vault and queue the history load. */
export async function connectGarmin(db: Db, userId: string, apiKey: string, keyExpiresOn: string): Promise<ConnectResult> {
  let token;
  try {
    token = await exchangeKey(apiKey);
  } catch (err) {
    if (err instanceof GarminAuthError) return { ok: false, reason: "rejected" };
    if (err instanceof GarminRateLimitError) return { ok: false, reason: "rate_limited" };
    return { ok: false, reason: "unavailable" };
  }

  await setSecret(db, secretName.apiKey(userId), apiKey.trim());
  await setSecret(db, secretName.accessToken(userId), token.token);

  await db
    .insert(garminConnection)
    // lastPlannedAt = now: the backfill below already covers today, so skip the first incremental plan.
    .values({ userId, status: "active", keyExpiresOn, tokenExpiresAt: token.expiresAt, backfillComplete: false, lastError: null, lastPlannedAt: new Date() })
    .onConflictDoUpdate({
      target: garminConnection.userId,
      set: { status: "active", keyExpiresOn, tokenExpiresAt: token.expiresAt, lastError: null, lastPlannedAt: new Date() },
    });

  await queueJobs(db, userId, planBackfill(today()));
  return { ok: true };
}

/** Delete the key and token, stop syncing. Synced data is kept (separate delete action). */
export async function disconnectGarmin(db: Db, userId: string): Promise<void> {
  await deleteSecret(db, secretName.apiKey(userId));
  await deleteSecret(db, secretName.accessToken(userId));
  await db.update(garminConnection).set({ status: "removed", tokenExpiresAt: null }).where(eq(garminConnection.userId, userId));
  await db.delete(syncJobs).where(and(eq(syncJobs.userId, userId), inArray(syncJobs.status, ["queued", "running"])));
}

async function queueJobs(db: Db, userId: string, jobs: PlannedJob[]): Promise<void> {
  if (jobs.length === 0) return;
  await db
    .insert(syncJobs)
    .values(
      jobs.map((j) => ({
        userId,
        kind: j.kind,
        dataType: j.dataType,
        rangeFrom: toInstant(j.from),
        rangeTo: toInstant(j.to),
      })),
    )
    // The same range may have run before (overlap days): queue it again unless it's already waiting.
    .onConflictDoUpdate({
      target: [syncJobs.userId, syncJobs.dataType, syncJobs.rangeFrom, syncJobs.rangeTo],
      set: { status: "queued", attempts: 0, runAfter: sql`now()`, error: null, lockedAt: null },
      setWhere: inArray(syncJobs.status, ["done", "failed"]),
    });
}

// ---------------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------------

async function accessTokenFor(db: Db, userId: string, tokenExpiresAt: Date | null): Promise<string> {
  if (!needsRenewal(tokenExpiresAt)) {
    const cached = await getSecret(db, secretName.accessToken(userId));
    if (cached) return cached;
  }
  const key = await getSecret(db, secretName.apiKey(userId));
  if (!key) throw new GarminAuthError(401);
  const fresh = await exchangeKey(key);
  await setSecret(db, secretName.accessToken(userId), fresh.token);
  await db.update(garminConnection).set({ tokenExpiresAt: fresh.expiresAt }).where(eq(garminConnection.userId, userId));
  return fresh.token;
}

// ---------------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------------

export interface TickOptions {
  /** Only this user's jobs (the "Sync now" button). Omit for the cron tick. */
  userId?: string;
  budgetMs: number;
  maxJobs?: number;
}

export interface TickResult {
  jobsDone: number;
  jobsFailed: number;
  payloadsStored: number;
  stoppedBy: "budget" | "empty" | "max_jobs";
}

export async function runTick(db: Db, opts: TickOptions): Promise<TickResult> {
  const started = Date.now();
  const result: TickResult = { jobsDone: 0, jobsFailed: 0, payloadsStored: 0, stoppedBy: "empty" };

  await expireKeys(db);
  await releaseStaleLocks(db);
  await planDueIncrementals(db, opts.userId);

  const pausedUsers = new Set<string>();
  const maxJobs = opts.maxJobs ?? 50;

  for (let n = 0; ; n++) {
    if (Date.now() - started > opts.budgetMs) return { ...result, stoppedBy: "budget" };
    if (n >= maxJobs) return { ...result, stoppedBy: "max_jobs" };

    const job = await claimJob(db, opts.userId, [...pausedUsers]);
    if (!job) return result;

    // Data types we no longer fetch (e.g. stress, now read from daily summaries).
    if (!(job.dataType in DATA_TYPES)) {
      await db.update(syncJobs).set({ status: "done", lockedAt: null }).where(eq(syncJobs.id, job.id));
      continue;
    }

    const conn = await db.query.garminConnection.findFirst({ where: eq(garminConnection.userId, job.userId) });
    if (!conn || conn.status !== "active") {
      await db.update(syncJobs).set({ status: "queued", lockedAt: null }).where(eq(syncJobs.id, job.id));
      pausedUsers.add(job.userId);
      continue;
    }

    try {
      const token = await accessTokenFor(db, job.userId, conn.tokenExpiresAt);
      const payloads = await fetchJob(new GarminClient(token), {
        dataType: job.dataType as DataType,
        from: toDate(job.rangeFrom),
        to: toDate(job.rangeTo),
      });
      result.payloadsStored += await storePayloads(db, job, payloads);
      await completeJob(db, job, conn.lastSyncedAt);
      result.jobsDone++;
    } catch (err) {
      pausedUsers.add(job.userId);
      if (err instanceof GarminAuthError) {
        await db
          .update(garminConnection)
          .set({ status: "key_invalid", lastError: "Garmin rejected the API key. Paste a new key in Settings." })
          .where(eq(garminConnection.userId, job.userId));
        await db.update(syncJobs).set({ status: "queued", lockedAt: null, attempts: job.attempts - 1 }).where(eq(syncJobs.id, job.id));
      } else if (err instanceof GarminRateLimitError) {
        await db
          .update(syncJobs)
          .set({ status: "queued", lockedAt: null, attempts: job.attempts - 1, runAfter: new Date(Date.now() + err.retryAfterSeconds * 1000) })
          .where(eq(syncJobs.id, job.id));
      } else {
        const message = err instanceof Error ? err.message : "Unknown error";
        const giveUp = job.attempts >= MAX_ATTEMPTS;
        await db
          .update(syncJobs)
          .set({
            status: giveUp ? "failed" : "queued",
            lockedAt: null,
            error: message.slice(0, 500),
            runAfter: new Date(Date.now() + 2 ** job.attempts * 60_000),
          })
          .where(eq(syncJobs.id, job.id));
        if (giveUp) result.jobsFailed++;
      }
    }
  }
}

type JobRow = typeof syncJobs.$inferSelect;

/** Atomically take the next due job: incremental first, then backfill newest-first. */
async function claimJob(db: Db, userId: string | undefined, excludeUsers: string[]): Promise<JobRow | null> {
  const userFilter = userId ? sql`and user_id = ${userId}` : sql``;
  const excludeFilter =
    excludeUsers.length > 0 ? sql`and user_id not in (${sql.join(excludeUsers.map((u) => sql`${u}::uuid`), sql`, `)})` : sql``;

  const rows = await db.execute<{ id: number }>(sql`
    update sync_jobs set status = 'running', locked_at = now(), attempts = attempts + 1, updated_at = now()
    where id = (
      select id from sync_jobs
      where status = 'queued' and run_after <= now() ${userFilter} ${excludeFilter}
      order by (kind = 'incremental') desc, range_to desc, id
      limit 1
      for update skip locked
    )
    returning id`);
  const id = rows[0]?.id;
  if (id === undefined) return null;
  return (await db.query.syncJobs.findFirst({ where: eq(syncJobs.id, Number(id)) })) ?? null;
}

async function storePayloads(db: Db, job: JobRow, payloads: Array<{ endpoint: string; payload: unknown }>): Promise<number> {
  let stored = 0;
  for (const { endpoint, payload } of payloads) {
    if (payload === null) continue;
    const json = JSON.stringify(payload);
    const sha256 = createHash("sha256").update(json).digest("hex");
    const dupe = await db.query.rawIngest.findFirst({
      columns: { id: true },
      where: and(eq(rawIngest.userId, job.userId), eq(rawIngest.endpoint, endpoint), eq(rawIngest.sha256, sha256)),
    });
    if (dupe) continue;
    await db.insert(rawIngest).values({
      userId: job.userId,
      endpoint,
      rangeFrom: job.rangeFrom,
      rangeTo: job.rangeTo,
      payload,
      sha256,
    });
    stored++;
  }
  return stored;
}

async function completeJob(db: Db, job: JobRow, lastSynced: Record<string, string>): Promise<void> {
  await db.update(syncJobs).set({ status: "done", lockedAt: null, error: null }).where(eq(syncJobs.id, job.id));

  const to = toDate(job.rangeTo);
  const previous = lastSynced[job.dataType];
  const remainingBackfill = await db.$count(
    syncJobs,
    and(eq(syncJobs.userId, job.userId), eq(syncJobs.kind, "backfill"), inArray(syncJobs.status, ["queued", "running"])),
  );
  await db
    .update(garminConnection)
    .set({
      lastSyncedAt: sql`${garminConnection.lastSyncedAt} || ${JSON.stringify(
        !previous || previous < to ? { [job.dataType]: to } : {},
      )}::jsonb`,
      backfillComplete: remainingBackfill === 0,
      lastError: null,
    })
    .where(eq(garminConnection.userId, job.userId));
}

async function planDueIncrementals(db: Db, userId?: string): Promise<void> {
  const cutoff = new Date(Date.now() - REPLAN_EVERY_MS);
  const due = await db.query.garminConnection.findMany({
    where: and(
      eq(garminConnection.status, "active"),
      userId ? eq(garminConnection.userId, userId) : undefined,
      or(isNull(garminConnection.lastPlannedAt), lt(garminConnection.lastPlannedAt, cutoff)),
    ),
  });
  for (const conn of due) {
    const last = Object.fromEntries(
      ALL_DATA_TYPES.filter((t) => conn.lastSyncedAt[t]).map((t) => [t, conn.lastSyncedAt[t]]),
    ) as Partial<Record<DataType, string>>;
    await queueJobs(db, conn.userId, planIncremental(today(), last));
    await db.update(garminConnection).set({ lastPlannedAt: new Date() }).where(eq(garminConnection.userId, conn.userId));
  }
}

async function releaseStaleLocks(db: Db): Promise<void> {
  await db
    .update(syncJobs)
    .set({ status: "queued", lockedAt: null })
    .where(and(eq(syncJobs.status, "running"), lt(syncJobs.lockedAt, new Date(Date.now() - STALE_LOCK_MS))));
}

async function expireKeys(db: Db): Promise<void> {
  await db
    .update(garminConnection)
    .set({ status: "key_expired", lastError: "Your Garmin API key has expired. Create a new one and paste it in Settings." })
    .where(and(eq(garminConnection.status, "active"), lt(garminConnection.keyExpiresOn, today())));
}
