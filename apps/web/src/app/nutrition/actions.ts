"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { scaleNutrients } from "@ft/metrics";
import { isBarcode, type FoodProduct } from "@/lib/off";
import { createClient } from "@/lib/supabase/server";
import { lookupBarcode, searchFoods } from "@/server/off";
import { requireUserId } from "@/server/session";

// Every write goes through the user's own session, so RLS ties rows to them.

export type SavedFood = FoodProduct & { id: number | null; source: "custom" | "off" };

const product = z.object({
  name: z.string().trim().min(1).max(120),
  brand: z.string().trim().max(80).nullable(),
  barcode: z.string().nullable().refine((b) => b === null || isBarcode(b), "invalid barcode"),
  kcal100g: z.number().min(0).max(900),
  protein100g: z.number().min(0).max(100).nullable(),
  carbs100g: z.number().min(0).max(100).nullable(),
  fat100g: z.number().min(0).max(100).nullable(),
  fibre100g: z.number().min(0).max(100).nullable(),
  servingG: z.number().positive().max(2000).nullable(),
});

const toSaved = (r: Record<string, unknown>): SavedFood => ({
  id: r.id as number,
  source: r.source as "custom" | "off",
  name: r.name as string,
  brand: (r.brand as string | null) ?? null,
  barcode: (r.barcode as string | null) ?? null,
  kcal100g: r.kcal_100g as number,
  protein100g: (r.protein_100g as number | null) ?? null,
  carbs100g: (r.carbs_100g as number | null) ?? null,
  fat100g: (r.fat_100g as number | null) ?? null,
  fibre100g: (r.fibre_100g as number | null) ?? null,
  servingG: (r.serving_g as number | null) ?? null,
});

/** Your saved foods first, then Open Food Facts. */
export async function findFoods(query: string): Promise<{ mine: SavedFood[]; off: SavedFood[]; offUnavailable: boolean }> {
  await requireUserId();
  const q = String(query ?? "").trim().slice(0, 80);
  if (q.length < 2) return { mine: [], off: [], offUnavailable: false };
  const supabase = await createClient();
  const pattern = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const [{ data: mine }, off] = await Promise.all([
    supabase.from("foods").select("*").ilike("name", pattern).order("name").limit(10),
    searchFoods(q),
  ]);
  return {
    mine: (mine ?? []).map(toSaved),
    off: off === "unavailable" ? [] : off.map((p) => ({ ...p, id: null, source: "off" as const })),
    offUnavailable: off === "unavailable",
  };
}

export async function findBarcode(barcode: string): Promise<{ food: SavedFood | null; message?: string }> {
  await requireUserId();
  const code = String(barcode ?? "").trim();
  if (!isBarcode(code)) return { food: null, message: "That isn't a valid barcode (8, 12, 13 or 14 digits)." };
  const supabase = await createClient();
  const { data: mine } = await supabase.from("foods").select("*").eq("barcode", code).maybeSingle();
  if (mine) return { food: toSaved(mine) };
  const found = await lookupBarcode(code);
  if (found === "unavailable") return { food: null, message: "Open Food Facts isn't responding. Try again, or add it as a custom food." };
  if (!found) return { food: null, message: "Not found on Open Food Facts. You can add it as a custom food." };
  return { food: { ...found, id: null, source: "off" } };
}

const logInput = z.object({
  food: product.extend({ id: z.number().int().positive().nullable(), source: z.enum(["custom", "off"]) }),
  grams: z.number().positive().max(5000),
  meal: z.enum(["breakfast", "lunch", "dinner", "snack"]),
  date: z.iso.date(),
});

/** Add a diary entry; foods from Open Food Facts are saved to your foods for next time. */
export async function logFood(input: unknown): Promise<{ ok: boolean; message?: string }> {
  const userId = await requireUserId();
  const parsed = logInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Check the amount (up to 5,000 g) and the food's values." };
  const { food, grams, meal, date } = parsed.data;
  const supabase = await createClient();

  if (food.id === null && food.source === "off") {
    const row = {
      user_id: userId,
      name: food.name,
      brand: food.brand,
      barcode: food.barcode,
      kcal_100g: food.kcal100g,
      protein_100g: food.protein100g,
      carbs_100g: food.carbs100g,
      fat_100g: food.fat100g,
      fibre_100g: food.fibre100g,
      serving_g: food.servingG,
      source: "off",
    };
    // Saved by barcode when there is one, so scanning it again finds it instantly.
    if (food.barcode) await supabase.from("foods").upsert(row, { onConflict: "user_id,barcode" });
    else await supabase.from("foods").insert(row);
  }

  const n = scaleNutrients({ kcal: food.kcal100g, protein: food.protein100g, carbs: food.carbs100g, fat: food.fat100g, fibre: food.fibre100g }, grams);
  const { error } = await supabase.from("food_log").insert({
    user_id: userId,
    local_date: date,
    meal,
    name: food.brand ? `${food.name} (${food.brand})`.slice(0, 160) : food.name,
    grams,
    kcal: n.kcal,
    protein_g: n.protein,
    carbs_g: n.carbs,
    fat_g: n.fat,
    fibre_g: n.fibre,
  });
  if (error) return { ok: false, message: "Couldn't save that entry. Try again." };
  revalidatePath("/nutrition");
  return { ok: true };
}

export async function deleteLogEntry(formData: FormData): Promise<void> {
  await requireUserId();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) return;
  const supabase = await createClient();
  await supabase.from("food_log").delete().eq("id", id);
  revalidatePath("/nutrition");
}

const custom = z.object({
  name: z.string().trim().min(1).max(120),
  brand: z.string().trim().max(80).optional().transform((v) => v || null),
  kcal: z.coerce.number().min(0).max(900),
  protein: z.union([z.literal(""), z.coerce.number().min(0).max(100)]).transform((v) => (v === "" ? null : v)),
  carbs: z.union([z.literal(""), z.coerce.number().min(0).max(100)]).transform((v) => (v === "" ? null : v)),
  fat: z.union([z.literal(""), z.coerce.number().min(0).max(100)]).transform((v) => (v === "" ? null : v)),
  serving: z.union([z.literal(""), z.coerce.number().positive().max(2000)]).transform((v) => (v === "" ? null : v)),
  barcode: z.union([z.literal(""), z.string().refine(isBarcode)]).transform((v) => (v === "" ? null : v)),
});

export async function createCustomFood(input: Record<string, string>): Promise<{ food: SavedFood | null; message?: string }> {
  const userId = await requireUserId();
  const parsed = custom.safeParse(input);
  if (!parsed.success) return { food: null, message: "Give it a name and energy per 100 g (0–900 kcal); other values 0–100 g." };
  const f = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("foods")
    .insert({
      user_id: userId,
      name: f.name,
      brand: f.brand,
      barcode: f.barcode,
      kcal_100g: f.kcal,
      protein_100g: f.protein,
      carbs_100g: f.carbs,
      fat_100g: f.fat,
      serving_g: f.serving,
      source: "custom",
    })
    .select("*")
    .single();
  if (error || !data) return { food: null, message: error?.code === "23505" ? "You already have a food with that barcode." : "Couldn't save that food." };
  revalidatePath("/nutrition");
  return { food: toSaved(data) };
}

export async function deleteFood(formData: FormData): Promise<void> {
  await requireUserId();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) return;
  const supabase = await createClient();
  await supabase.from("foods").delete().eq("id", id);
  revalidatePath("/nutrition");
}

export type FormState = { status: "idle" | "saved" | "error"; message?: string };

const weight = z.object({ date: z.iso.date(), kg: z.coerce.number().min(20).max(400), fat: z.union([z.literal(""), z.coerce.number().min(2).max(75)]) });

export async function saveWeight(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId();
  const parsed = weight.safeParse({ date: formData.get("date"), kg: formData.get("kg"), fat: formData.get("fat") ?? "" });
  if (!parsed.success) return { status: "error", message: "Enter a weight between 20 and 400 kg (body fat 2–75%, optional)." };
  const supabase = await createClient();
  const { error } = await supabase.from("body_measurements").upsert(
    {
      user_id: userId,
      local_date: parsed.data.date,
      source: "manual",
      weight_kg: parsed.data.kg,
      body_fat_pct: parsed.data.fat === "" ? null : parsed.data.fat,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,local_date,source" },
  );
  if (error) return { status: "error", message: "Couldn't save that. Try again." };
  revalidatePath("/nutrition");
  revalidatePath("/trends");
  return { status: "saved", message: "Saved." };
}

export async function deleteWeight(formData: FormData): Promise<void> {
  await requireUserId();
  const date = String(formData.get("date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const supabase = await createClient();
  await supabase.from("body_measurements").delete().eq("local_date", date).eq("source", "manual");
  revalidatePath("/nutrition");
  revalidatePath("/trends");
}

const profileForm = z.object({
  heightCm: z.union([z.literal(""), z.coerce.number().min(100).max(250)]),
  birthYear: z.union([z.literal(""), z.coerce.number().int().min(1900).max(new Date().getUTCFullYear() - 16)]),
  sex: z.enum(["", "female", "male"]),
  goal: z.enum(["lose", "maintain", "gain"]),
});

/** Only what the energy formula needs: height, birth year (not date of birth) and, optionally, sex. */
export async function saveNutritionProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  const userId = await requireUserId();
  const parsed = profileForm.safeParse({
    heightCm: formData.get("heightCm") ?? "",
    birthYear: formData.get("birthYear") ?? "",
    sex: formData.get("sex") ?? "",
    goal: formData.get("goal") ?? "maintain",
  });
  if (!parsed.success) return { status: "error", message: "Height 100–250 cm; birth year for an adult (16 or over)." };
  const p = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("profile").upsert(
    {
      user_id: userId,
      height_cm: p.heightCm === "" ? null : p.heightCm,
      birth_year: p.birthYear === "" ? null : p.birthYear,
      sex: p.sex === "" ? null : p.sex,
      nutrition_goal: p.goal,
    },
    { onConflict: "user_id" },
  );
  if (error) return { status: "error", message: "Couldn't save that. Try again." };
  revalidatePath("/nutrition");
  return { status: "saved", message: "Saved." };
}
