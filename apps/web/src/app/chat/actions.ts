"use server";

import { schema } from "@ft/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db";
import { requireUserId } from "@/server/session";

// Chats are written only by server code (RLS lets users read their own), so
// these use the privileged connection, always filtered by the verified user id.

const rename = z.object({ id: z.uuid(), title: z.string().trim().min(1).max(80) });

export async function renameChat(input: unknown): Promise<{ ok: boolean; message?: string }> {
  const userId = await requireUserId();
  const parsed = rename.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Give the chat a name of up to 80 characters." };
  const { id, title } = parsed.data;
  const rows = await getDb()
    .update(schema.chatConversations)
    .set({ title })
    .where(and(eq(schema.chatConversations.id, id), eq(schema.chatConversations.userId, userId)))
    .returning({ id: schema.chatConversations.id });
  return rows.length ? { ok: true } : { ok: false, message: "That chat doesn't exist." };
}

/** Deletes the chat and, by cascade, its messages. */
export async function deleteChat(input: unknown): Promise<{ ok: boolean }> {
  const userId = await requireUserId();
  const id = z.uuid().safeParse(input);
  if (!id.success) return { ok: false };
  await getDb()
    .delete(schema.chatConversations)
    .where(and(eq(schema.chatConversations.id, id.data), eq(schema.chatConversations.userId, userId)));
  return { ok: true };
}
