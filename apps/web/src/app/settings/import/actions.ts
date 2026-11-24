"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { IMPORT_SOURCES, importBatch } from "@/lib/import/rows";
import { getDb } from "@/server/db";
import { removeDemoData } from "@/server/demo";
import { recomputeDerived } from "@/server/derive";
import { deleteAppleHealth, importRows } from "@/server/imports";
import { requireUserId } from "@/server/session";

const source = z.enum(IMPORT_SOURCES);

export type BatchOutcome = { ok: true; written: number; superseded: number } | { ok: false; message: string };

/** Before the first batch: imported data replaces demo data (the two are never mixed). */
export async function startImport(): Promise<void> {
  const userId = await requireUserId();
  await removeDemoData(getDb(), userId);
}

/**
 * One batch of rows parsed in the browser. Validated again here: the user id
 * comes from the session, never from the request, and every row must pass the
 * canonical schemas or the whole batch is refused.
 */
export async function importBatchAction(rawSource: unknown, rawBatch: unknown): Promise<BatchOutcome> {
  const userId = await requireUserId();
  const s = source.safeParse(rawSource);
  const batch = importBatch.safeParse(rawBatch);
  if (!s.success || !batch.success) return { ok: false, message: "This batch didn't pass validation, so nothing from it was saved." };
  try {
    const r = await importRows(getDb(), userId, s.data, batch.data);
    return { ok: true, ...r };
  } catch (err) {
    console.error("importBatch failed:", err instanceof Error ? err.message : err);
    return { ok: false, message: "Saving this batch failed. Try the import again; rows already saved won't be duplicated." };
  }
}

/** After the last batch: recompute estimates over the new history. */
export async function finishImport(): Promise<void> {
  const userId = await requireUserId();
  try {
    await recomputeDerived(getDb(), userId);
  } catch (err) {
    console.error("finishImport recompute failed:", err instanceof Error ? err.message : err);
  }
  revalidatePath("/", "layout");
}

export async function deleteAppleHealthData(): Promise<void> {
  const userId = await requireUserId();
  const db = getDb();
  await deleteAppleHealth(db, userId);
  await recomputeDerived(db, userId);
  revalidatePath("/", "layout");
}
