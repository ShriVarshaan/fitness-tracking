"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { buildPlan, findTemplate } from "@/lib/plans";
import { createClient } from "@/lib/supabase/server";
import { getDb } from "@/server/db";
import { recomputeDerived } from "@/server/derive";
import { requireUserId } from "@/server/session";

// Writes go through the user's own session, so RLS ties every row to them.

/** Plans feed the morning "plan vs readiness" check; refresh it, but never fail the save. */
async function refresh(userId: string): Promise<void> {
  try {
    await recomputeDerived(getDb(), userId);
  } catch (err) {
    console.error("recompute after plan change failed:", err instanceof Error ? err.message : err);
  }
  revalidatePath("/training");
  revalidatePath("/");
}

export type FormState = { status: "idle" | "error"; message?: string };

export async function createPlanFromTemplate(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId();
  const template = findTemplate(String(formData.get("template") ?? ""));
  const start = String(formData.get("start") ?? "");
  if (!template || !/^\d{4}-\d{2}-\d{2}$/.test(start)) return { status: "error", message: "Choose a plan and a start date." };

  const supabase = await createClient();
  const { data: plan, error } = await supabase
    .from("training_plans")
    .insert({ user_id: userId, name: template.name, template: template.key, start_date: start })
    .select("id")
    .single();
  if (error || !plan) return { status: "error", message: "Couldn't create the plan. Try again." };

  const sessions = buildPlan(template, start).map((s) => ({
    user_id: userId,
    plan_id: plan.id,
    local_date: s.date,
    sport: s.sport,
    title: s.title,
    intensity: s.intensity,
    target_duration_s: s.targetDurationS,
    steps: s.steps,
    notes: s.notes,
  }));
  const { error: wErr } = await supabase.from("planned_workouts").insert(sessions);
  if (wErr) {
    await supabase.from("training_plans").delete().eq("id", plan.id);
    return { status: "error", message: "Couldn't create the plan's workouts. Try again." };
  }
  await refresh(userId);
  redirect(`/training?week=${start}`);
}

export async function deletePlan(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) return;
  const supabase = await createClient();
  // Its workouts go with it (on delete cascade).
  await supabase.from("training_plans").delete().eq("id", id);
  await refresh(userId);
}

const step = z.object({
  kind: z.enum(["warmup", "work", "recover", "cooldown"]),
  durationS: z.number().int().min(0).max(86400).nullable().optional(),
  distanceM: z.number().min(0).max(500000).nullable().optional(),
  target: z.string().trim().max(80).nullable().optional(),
  repeat: z.number().int().min(1).max(50).nullable().optional(),
});

const workout = z.object({
  id: z.number().int().positive().nullable(),
  date: z.iso.date(),
  sport: z.enum(["running", "cycling", "swimming", "strength", "walking", "other"]),
  title: z.string().trim().min(1).max(80),
  intensity: z.enum(["easy", "moderate", "hard", "long"]),
  targetDurationS: z.number().int().min(0).max(86400).nullable(),
  targetDistanceM: z.number().min(0).max(500000).nullable(),
  steps: z.array(step).max(30),
  notes: z.string().trim().max(500).nullable(),
});

/** Create or update a workout (the workout builder). */
export async function saveWorkout(input: unknown): Promise<{ ok: boolean; message?: string }> {
  const userId = await requireUserId();
  const parsed = workout.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the title (up to 80 characters), date and steps (up to 30)." };
  const w = parsed.data;
  const row = {
    user_id: userId,
    local_date: w.date,
    sport: w.sport,
    title: w.title,
    intensity: w.intensity,
    target_duration_s: w.targetDurationS,
    target_distance_m: w.targetDistanceM,
    steps: w.steps,
    notes: w.notes || null,
  };
  const supabase = await createClient();
  const { error } = w.id ? await supabase.from("planned_workouts").update(row).eq("id", w.id) : await supabase.from("planned_workouts").insert(row);
  if (error) return { ok: false, message: "Couldn't save the workout. Try again." };
  await refresh(userId);
  return { ok: true };
}

export async function deleteWorkout(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) return;
  const supabase = await createClient();
  await supabase.from("planned_workouts").delete().eq("id", id);
  await refresh(userId);
  redirect("/training");
}
