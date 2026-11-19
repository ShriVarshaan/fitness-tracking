"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DASHBOARD_TEMPLATES, panelsSchema } from "@/lib/dashboard";
import { createClient } from "@/lib/supabase/server";
import { requireUserId } from "@/server/session";

// Writes go through the user's own session, so RLS ties every row to them.

export async function createDashboard(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const key = String(formData.get("template") ?? "blank");
  const template = DASHBOARD_TEMPLATES.find((t) => t.key === key);
  const supabase = await createClient();
  const { data } = await supabase
    .from("dashboards")
    .insert({ user_id: userId, name: template?.name ?? "My dashboard", panels: template?.panels ?? [] })
    .select("id")
    .single();
  revalidatePath("/dashboards");
  if (data) redirect(`/dashboards/${data.id}${template ? "" : "?edit=1"}`);
}

const save = z.object({ id: z.number().int().positive(), name: z.string().trim().min(1).max(60), panels: panelsSchema });

export async function saveDashboard(input: unknown): Promise<{ ok: boolean; message?: string }> {
  await requireUserId();
  const parsed = save.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the dashboard name and panels." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("dashboards")
    .update({ name: parsed.data.name, panels: parsed.data.panels, updated_at: new Date().toISOString() })
    .eq("id", parsed.data.id);
  if (error) return { ok: false, message: "Couldn't save the dashboard." };
  revalidatePath(`/dashboards/${parsed.data.id}`);
  revalidatePath("/dashboards");
  return { ok: true };
}

export async function deleteDashboard(formData: FormData): Promise<void> {
  await requireUserId();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) return;
  const supabase = await createClient();
  await supabase.from("dashboards").delete().eq("id", id);
  revalidatePath("/dashboards");
  redirect("/dashboards");
}
