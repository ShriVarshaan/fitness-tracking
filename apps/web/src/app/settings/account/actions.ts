"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@ft/db";
import { createClient } from "@/lib/supabase/server";
import { aiAvailable } from "@/server/ai";
import { getDb } from "@/server/db";
import { recomputeDerived } from "@/server/derive";
import { deleteSecret, secretName } from "@/server/secrets";
import { requireUserId } from "@/server/session";

export type FormState = { status: "idle" | "saved" | "error"; message?: string };

const sleepNeed = z.coerce.number().int().min(300).max(660);

export async function saveSleepNeed(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId();
  const parsed = sleepNeed.safeParse(formData.get("sleepNeedMin"));
  if (!parsed.success) return { status: "error", message: "Choose a sleep need between 5 and 11 hours." };

  const db = getDb();
  await db
    .insert(schema.profile)
    .values({ userId, sleepNeedMin: parsed.data })
    .onConflictDoUpdate({ target: schema.profile.userId, set: { sleepNeedMin: parsed.data } });
  // Sleep debt, readiness and the insight all depend on it.
  try {
    await recomputeDerived(db, userId);
  } catch (err) {
    console.error("recompute after sleep need change failed:", err instanceof Error ? err.message : err);
  }
  revalidatePath("/");
  revalidatePath("/settings/account");
  return { status: "saved", message: "Saved. Estimates have been updated." };
}

/** Opt in or out of AI wording. Turning it on needs explicit consent (Garmin terms and UK GDPR). */
export async function setAiWording(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId();
  const enable = formData.get("enable") === "1";
  if (enable && !aiAvailable()) return { status: "error", message: "AI wording isn't available on this server." };
  if (enable && formData.get("consent") !== "on") {
    return { status: "error", message: "Tick the box to agree before turning this on." };
  }

  const db = getDb();
  const values = { aiEnabled: enable, aiConsentedAt: enable ? new Date() : null };
  await db
    .insert(schema.profile)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: schema.profile.userId, set: values });
  try {
    await recomputeDerived(db, userId); // rewrite (or revert) today's insight
  } catch (err) {
    console.error("recompute after AI toggle failed:", err instanceof Error ? err.message : err);
  }
  revalidatePath("/");
  revalidatePath("/settings/account");
  return { status: "saved", message: enable ? "AI wording is on." : "AI wording is off. Insights use the standard wording." };
}

/**
 * Permanently delete the account: Garmin secrets from Vault, then the auth user,
 * which cascades to every table (all user_id columns reference auth.users on delete cascade).
 */
export async function deleteAccount(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId();
  if (String(formData.get("confirm") ?? "").trim().toLowerCase() !== "delete") {
    return { status: "error", message: 'Type "delete" to confirm.' };
  }

  const db = getDb();
  try {
    await deleteSecret(db, secretName.apiKey(userId));
    await deleteSecret(db, secretName.accessToken(userId));
    await db.execute(sql`delete from auth.users where id = ${userId}::uuid`);
  } catch (err) {
    console.error("deleteAccount failed:", err instanceof Error ? err.message : err);
    return { status: "error", message: "Couldn't delete the account. Nothing was removed; try again shortly." };
  }

  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login?deleted=1");
}
