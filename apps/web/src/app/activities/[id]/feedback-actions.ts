"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getDb } from "@/server/db";
import { recomputeDerived } from "@/server/derive";
import { requireUserId } from "@/server/session";

export type FeedbackState = { status: "idle" | "saved" | "error"; message?: string };

const form = z.object({
  id: z.string().regex(/^[\w-]{1,64}$/),
  source: z.enum(["garmin", "demo"]),
  rpe: z.union([z.literal(""), z.coerce.number().int().min(1).max(10)]),
  note: z.string().trim().max(500),
});

/** Save the user's effort rating and note for one of their activities, then refresh estimates that use it. */
export async function saveFeedback(_prev: FeedbackState, formData: FormData): Promise<FeedbackState> {
  const userId = await requireUserId();
  const parsed = form.safeParse({
    id: formData.get("id"),
    source: formData.get("source"),
    rpe: formData.get("rpe") ?? "",
    note: formData.get("note") ?? "",
  });
  if (!parsed.success) return { status: "error", message: "Choose an effort from 1 to 10, and keep the note under 500 characters." };
  const { id, source, rpe, note } = parsed.data;

  // Through the user's own session: RLS checks the row is theirs, and the activity must be visible to them.
  const supabase = await createClient();
  const { data: activity } = await supabase.from("activities").select("source_record_id").eq("source_record_id", id).eq("source", source).maybeSingle();
  if (!activity) return { status: "error", message: "Activity not found." };

  const { error } = await supabase.from("activity_feedback").upsert(
    { user_id: userId, source, source_record_id: id, rpe: rpe === "" ? null : rpe, note: note || null, updated_at: new Date().toISOString() },
    { onConflict: "user_id,source,source_record_id" },
  );
  if (error) return { status: "error", message: "Couldn't save that. Try again." };

  // The post-workout summary uses the rating.
  try {
    await recomputeDerived(getDb(), userId);
  } catch (err) {
    console.error("recompute after feedback failed:", err instanceof Error ? err.message : err);
  }
  revalidatePath(`/activities/${id}`);
  revalidatePath("/");
  return { status: "saved", message: "Saved." };
}
