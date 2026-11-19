"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { schema } from "@ft/db";
import { PUSH_KINDS } from "@/lib/push-rules";
import { getDb } from "@/server/db";
import { pushConfigured, sendToUser } from "@/server/push";
import { requireUserId } from "@/server/session";

const subscription = z.object({
  endpoint: z.url().max(1000).startsWith("https://"),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
  device: z.string().max(60).optional(),
});

/** Store this browser's push subscription for the signed-in user (the user id comes from the session). */
export async function savePushSubscription(input: unknown): Promise<{ ok: boolean; message?: string }> {
  const userId = await requireUserId();
  if (!pushConfigured()) return { ok: false, message: "Notifications aren't set up on this server." };
  const parsed = subscription.safeParse(input);
  if (!parsed.success) return { ok: false, message: "This browser returned an invalid subscription." };
  const { endpoint, keys, device } = parsed.data;
  // One row per endpoint: if another account used this browser before, it now belongs to this one.
  await getDb()
    .insert(schema.pushSubscriptions)
    .values({ userId, endpoint, p256dh: keys.p256dh, auth: keys.auth, device: device ?? null })
    .onConflictDoUpdate({
      target: schema.pushSubscriptions.endpoint,
      set: { userId, p256dh: keys.p256dh, auth: keys.auth, device: device ?? null, failures: 0, createdAt: new Date() },
    });
  revalidatePath("/settings/account");
  return { ok: true };
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  const userId = await requireUserId();
  if (typeof endpoint !== "string" || endpoint.length > 1000) return;
  await getDb()
    .delete(schema.pushSubscriptions)
    .where(and(eq(schema.pushSubscriptions.userId, userId), eq(schema.pushSubscriptions.endpoint, endpoint)));
  revalidatePath("/settings/account");
}

/** Remove a device from the list (by row id, only among the user's own). */
export async function removePushDevice(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) return;
  await getDb()
    .delete(schema.pushSubscriptions)
    .where(and(eq(schema.pushSubscriptions.userId, userId), eq(schema.pushSubscriptions.id, id)));
  revalidatePath("/settings/account");
}

export type KindsState = { status: "idle" | "saved"; message?: string };

export async function savePushKinds(_prev: KindsState, formData: FormData): Promise<KindsState> {
  const userId = await requireUserId();
  const kinds = PUSH_KINDS.filter((k) => formData.get(k) === "on");
  await getDb()
    .insert(schema.profile)
    .values({ userId, pushKinds: kinds })
    .onConflictDoUpdate({ target: schema.profile.userId, set: { pushKinds: kinds } });
  revalidatePath("/settings/account");
  return { status: "saved", message: kinds.length ? "Saved." : "Saved. No notifications will be sent." };
}

export async function sendTestPush(): Promise<{ ok: boolean; message: string }> {
  const userId = await requireUserId();
  const sent = await sendToUser(getDb(), userId, { title: "Fitness", body: "Notifications are working.", url: "/settings/account", tag: "test" });
  return sent > 0
    ? { ok: true, message: `Sent to ${sent} device${sent === 1 ? "" : "s"}.` }
    : { ok: false, message: "Couldn't deliver to any device. Try turning notifications off and on again." };
}
