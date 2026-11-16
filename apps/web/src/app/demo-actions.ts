"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/server/db";
import { loadDemoData, removeDemoData } from "@/server/demo";
import { recomputeDerived } from "@/server/derive";
import { requireUserId } from "@/server/session";

export async function loadDemo(): Promise<void> {
  const userId = await requireUserId();
  try {
    await loadDemoData(getDb(), userId);
  } catch (err) {
    console.error("loadDemo failed:", err instanceof Error ? err.message : err);
  }
  revalidatePath("/", "layout");
}

export async function removeDemo(): Promise<void> {
  const userId = await requireUserId();
  const db = getDb();
  try {
    await removeDemoData(db, userId);
    await recomputeDerived(db, userId);
  } catch (err) {
    console.error("removeDemo failed:", err instanceof Error ? err.message : err);
  }
  revalidatePath("/", "layout");
}
