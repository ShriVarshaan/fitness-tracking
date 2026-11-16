"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/server/db";
import { requireUserId } from "@/server/session";
import { recomputeDerived } from "@/server/derive";
import { processPending } from "@/server/process";
import { connectGarmin, disconnectGarmin, runTick } from "@/server/sync";

export type KeyFormState = { status: "idle" | "saved" | "error"; message?: string };

const LIFETIMES = ["30", "90", "180", "365"] as const;

const keyForm = z.object({
  apiKey: z.string().trim().min(10, { error: "That doesn't look like a Garmin API key." }).max(4096),
  lifetimeDays: z.enum(LIFETIMES, { error: "Choose how long the key lasts." }),
  createdOn: z.iso.date({ error: "Enter the date you created the key." }),
});

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export async function saveGarminKey(_prev: KeyFormState, formData: FormData): Promise<KeyFormState> {
  const userId = await requireUserId();
  const parsed = keyForm.safeParse({
    apiKey: formData.get("apiKey"),
    lifetimeDays: formData.get("lifetimeDays"),
    createdOn: formData.get("createdOn"),
  });
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message };

  const expiresOn = addDays(parsed.data.createdOn, Number(parsed.data.lifetimeDays));
  let result;
  try {
    result = await connectGarmin(getDb(), userId, parsed.data.apiKey, expiresOn);
  } catch (err) {
    // Log the cause server-side (never the key); show a plain message on the form.
    console.error("saveGarminKey failed:", err instanceof Error ? err.message : err);
    return { status: "error", message: "Something went wrong saving your key. Try again shortly." };
  }
  if (!result.ok) {
    const message = {
      rejected: "Garmin didn't accept that key. Check you copied all of it, and that it hasn't been deleted.",
      rate_limited: "Garmin is limiting requests right now. Wait a few minutes and try again.",
      unavailable: "Couldn't reach Garmin. Try again in a minute.",
    }[result.reason];
    return { status: "error", message };
  }

  revalidatePath("/settings/garmin");
  revalidatePath("/");
  return { status: "saved", message: "Key saved. Your history is loading in the background." };
}

export async function removeGarminKey(): Promise<void> {
  const userId = await requireUserId();
  try {
    await disconnectGarmin(getDb(), userId);
  } catch (err) {
    console.error("removeGarminKey failed:", err instanceof Error ? err.message : err);
  }
  revalidatePath("/settings/garmin");
  revalidatePath("/");
}

/** Run a short sync for this user only, so history appears without waiting for the next tick. */
export async function syncNow(): Promise<void> {
  const userId = await requireUserId();
  try {
    const db = getDb();
    await runTick(db, { userId, budgetMs: 20_000, maxJobs: 20 });
    await processPending(db, { userId, budgetMs: 10_000 });
    await recomputeDerived(db, userId);
  } catch (err) {
    console.error("syncNow failed:", err instanceof Error ? err.message : err);
  }
  revalidatePath("/settings/garmin");
  revalidatePath("/");
}
