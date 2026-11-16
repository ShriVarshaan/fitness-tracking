import "server-only";
import { localDate } from "@ft/core";
import { schema, type Db } from "@ft/db";
import { and, eq } from "drizzle-orm";
import { DEMO_TZ_OFFSET_MIN, generateDemoData } from "@/lib/demo-data";
import { recomputeDerived } from "./derive";

const { activities, dailySummaries, garminConnection, hrvDaily, sleepSessions } = schema;
const DEMO = "demo";

/** Delete every demo row for a user (real Garmin rows are untouched). */
export async function removeDemoData(db: Db, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    for (const table of [dailySummaries, sleepSessions, hrvDaily, activities]) {
      await tx.delete(table).where(and(eq(table.userId, userId), eq(table.source, DEMO)));
    }
  });
}

export type LoadDemoResult = { ok: true } | { ok: false; reason: "garmin_connected" };

/** Replace any demo data with a fresh 120-day set ending today, then recompute estimates. */
export async function loadDemoData(db: Db, userId: string): Promise<LoadDemoResult> {
  const conn = await db.query.garminConnection.findFirst({ where: eq(garminConnection.userId, userId) });
  if (conn && conn.status !== "removed") return { ok: false, reason: "garmin_connected" };

  // Seed from the user id so each account gets its own (stable) demo history.
  const seed = parseInt(userId.replace(/-/g, "").slice(0, 8), 16);
  const data = generateDemoData(localDate(new Date(), 0), seed);
  const base = { userId, source: DEMO, tzOffsetMin: DEMO_TZ_OFFSET_MIN };

  await removeDemoData(db, userId);
  await db.transaction(async (tx) => {
    await tx.insert(dailySummaries).values(data.days.map((d) => ({ ...base, ...d })));
    await tx.insert(sleepSessions).values(data.sleep.map((s) => ({ ...base, ...s, sourceRecordId: `demo-${s.localDate}` })));
    await tx.insert(hrvDaily).values(data.hrv.map((h) => ({ userId, source: DEMO, ...h })));
    await tx.insert(activities).values(data.activities.map((a) => ({ ...base, ...a, hasRoute: false })));
  });
  await recomputeDerived(db, userId);
  return { ok: true };
}
