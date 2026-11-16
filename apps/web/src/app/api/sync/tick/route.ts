import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/server/db";
import { recomputeDerived, usersMissingDerived } from "@/server/derive";
import { processPending, purgeExpired } from "@/server/process";
import { runTick } from "@/server/sync";

// Called by Supabase Cron every 5 minutes (supabase/migrations/*_sync_cron.sql).
export const maxDuration = 60;

function authorised(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const given = request.headers.get("authorization") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const db = getDb();
  const sync = await runTick(db, { budgetMs: 30_000 });
  const processed = await processPending(db, { budgetMs: 10_000 });

  const toDerive = [...new Set([...processed.touchedUsers, ...(await usersMissingDerived(db))])];
  for (const userId of toDerive.slice(0, 5)) await recomputeDerived(db, userId);

  const purged = await purgeExpired(db);

  return NextResponse.json({
    ...sync,
    processed: processed.processed,
    quarantined: processed.quarantined,
    derived: toDerive.length,
    purged,
  });
}
