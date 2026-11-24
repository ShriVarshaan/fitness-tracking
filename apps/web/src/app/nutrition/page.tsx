import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { addDays, localNow } from "@ft/core";
import { nutritionTargets, type NutritionGoal } from "@ft/metrics";
import { AppNav } from "@/components/app-nav";
import { formatDay, formatNumber } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { onePerDay } from "@/lib/weight";
import { deleteFood, deleteLogEntry, deleteWeight } from "./actions";
import { AddFood } from "./add-food";
import { ProfileForm, WeightForm } from "./forms";

export const metadata: Metadata = { title: "Nutrition" };

const MEALS = [
  ["breakfast", "Breakfast"],
  ["lunch", "Lunch"],
  ["dinner", "Dinner"],
  ["snack", "Snacks"],
] as const;

interface WeightRow {
  local_date: string;
  weight_kg: number;
  body_fat_pct: number | null;
  source: string;
}

interface LogRow {
  id: number;
  meal: string;
  name: string;
  grams: number;
  kcal: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
}

export default async function NutritionPage(props: PageProps<"/nutrition">) {
  // Every read goes through the user's session, so RLS limits it to their own rows.
  const supabase = await createClient();
  const { data: prof } = await supabase.from("profile").select("timezone, height_cm, birth_year, sex, nutrition_goal").maybeSingle();
  const today = localNow((prof?.timezone as string | undefined) ?? "Europe/London").date;
  const raw = (await props.searchParams).date;
  const asked = typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : today;
  const date = asked > today ? today : asked;
  const weekAgo = addDays(date, -7);

  const [{ data: log }, { data: weightData }, { data: days }, { data: acts }, { data: foods }] = await Promise.all([
    supabase.from("food_log").select("id, meal, name, grams, kcal, protein_g, carbs_g, fat_g").eq("local_date", date).order("created_at"),
    supabase.from("body_measurements").select("local_date, weight_kg, body_fat_pct, source").lte("local_date", date).order("local_date", { ascending: false }).limit(16),
    // Garmin's measured expenditure for the 7 complete days before this one.
    supabase.from("daily_summaries").select("local_date, total_kcal").gte("local_date", weekAgo).lt("local_date", date),
    supabase.from("activities").select("duration_s").gte("local_date", addDays(date, -6)).lte("local_date", date),
    supabase.from("foods").select("id, name, brand, kcal_100g, source").order("created_at", { ascending: false }).limit(30),
  ]);

  const entries = (log ?? []) as LogRow[];
  const weights = onePerDay((weightData ?? []) as WeightRow[]).slice(0, 8);
  const latestWeight = weights[0];
  // A weight older than 60 days is too stale to base targets on.
  const weightKg = latestWeight && addDays(latestWeight.local_date, 60) >= date ? latestWeight.weight_kg : null;
  const birthYear = (prof?.birth_year as number | null | undefined) ?? null;
  const targets = nutritionTargets({
    weightKg,
    heightCm: (prof?.height_cm as number | null | undefined) ?? null,
    age: birthYear ? Number(date.slice(0, 4)) - birthYear : null,
    sex: (prof?.sex as "female" | "male" | null | undefined) ?? null,
    goal: ((prof?.nutrition_goal as NutritionGoal | undefined) ?? "maintain"),
    recentTotalKcal: (days ?? []).map((d) => d.total_kcal as number | null).filter((k): k is number => typeof k === "number"),
    trainingMin7d: (acts ?? []).reduce((m, a) => m + ((a.duration_s as number | null) ?? 0) / 60, 0),
    sessions7d: (acts ?? []).length,
  });

  const sum = (k: "kcal" | "protein_g" | "carbs_g" | "fat_g") => entries.reduce((s, e) => s + (e[k] ?? 0), 0);
  const eaten = { kcal: sum("kcal"), protein: sum("protein_g"), carbs: sum("carbs_g"), fat: sum("fat_g") };

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-8 sm:py-10">
      <header className="space-y-3">
        <AppNav current="/nutrition" />
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Nutrition</h1>
          <nav aria-label="Day" className="flex items-center gap-3 text-sm">
            <Link href={`/nutrition?date=${addDays(date, -1)}`} className="text-muted underline-offset-4 hover:underline">
              ← Previous
            </Link>
            <span className="font-medium">{date === today ? "Today" : formatDay(date)}</span>
            {date < today && (
              <Link href={`/nutrition?date=${addDays(date, 1)}`} className="text-muted underline-offset-4 hover:underline">
                Next →
              </Link>
            )}
          </nav>
        </div>
      </header>

      <Card title="Targets" tag={targets.ok ? <Estimate confidence={targets.confidence} /> : undefined}>
        {targets.ok ? (
          <>
            <div className="space-y-3">
              <Bar label="Energy" eaten={eaten.kcal} target={targets.energyKcal} unit="kcal" />
              <Bar label="Protein" eaten={eaten.protein} target={targets.proteinG} unit="g" />
              <Bar label="Carbohydrate" eaten={eaten.carbs} target={targets.carbsG} unit="g" />
              <Bar label="Fat" eaten={eaten.fat} target={targets.fatG} unit="g" />
            </div>
            <p className="text-xs text-muted">
              {targets.expenditureSource === "garmin"
                ? `Based on Garmin's average daily energy use of ${formatNumber(targets.expenditureKcal)} kcal over the last week`
                : `Garmin energy use isn't available, so this uses an estimate of ${formatNumber(targets.expenditureKcal)} kcal (resting energy × 1.4)`}
              {prof?.nutrition_goal === "lose" ? ", less 500 kcal" : prof?.nutrition_goal === "gain" ? ", plus 300 kcal" : ""}. Protein{" "}
              {targets.proteinPerKg} g and carbohydrate {targets.carbsPerKg} g per kg of body weight ({targets.loadBand} training week).
              Never below your resting energy of {formatNumber(targets.bmrKcal)} kcal.{" "}
              <Link href="/methods" className="underline">
                How it&rsquo;s calculated
              </Link>
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">
            Not available: targets {targets.reason}. Add {weightKg === null ? "a recent weight below" : "your details below"}.
          </p>
        )}
      </Card>

      <Card title={`Food diary · ${formatNumber(eaten.kcal)} kcal`}>
        {entries.length === 0 && <p className="text-sm text-muted">Nothing logged for this day yet.</p>}
        {MEALS.map(([key, label]) => {
          const items = entries.filter((e) => e.meal === key);
          if (!items.length) return null;
          return (
            <div key={key} className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">
                {label} · {formatNumber(items.reduce((s, e) => s + e.kcal, 0))} kcal
              </p>
              <ul className="divide-y divide-border">
                {items.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate">{e.name}</span>
                      <span className="text-xs text-muted tabular-nums">
                        {formatNumber(e.grams)} g · P {formatNumber(e.protein_g)} · C {formatNumber(e.carbs_g)} · F {formatNumber(e.fat_g)}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      <span className="tabular-nums">{formatNumber(e.kcal)} kcal</span>
                      <form action={deleteLogEntry}>
                        <input type="hidden" name="id" value={e.id} />
                        <button type="submit" className="text-xs text-muted underline" aria-label={`Remove ${e.name}`}>
                          Remove
                        </button>
                      </form>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        <div className="border-t border-border pt-4">
          <h3 className="mb-3 text-sm font-medium">Add food</h3>
          <AddFood date={date} />
        </div>
      </Card>

      <Card title="Weight">
        {weights.length ? (
          <ul className="space-y-1 text-sm">
            {weights.map((w) => (
              <li key={w.local_date} className="flex items-center justify-between gap-3">
                <span>
                  {formatDay(w.local_date)} · <strong className="font-semibold tabular-nums">{formatNumber(w.weight_kg, 1)} kg</strong>
                  {w.body_fat_pct != null && <span className="text-muted"> · {formatNumber(w.body_fat_pct, 1)}% body fat</span>}
                </span>
                {w.source === "manual" ? (
                  <form action={deleteWeight}>
                    <input type="hidden" name="date" value={w.local_date} />
                    <button type="submit" className="text-xs text-muted underline">
                      Remove
                    </button>
                  </form>
                ) : (
                  <span className="text-xs text-muted">Garmin</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No weight recorded yet.</p>
        )}
        <WeightForm date={today} />
        <p className="text-xs text-muted">
          The trend is on the{" "}
          <Link href="/trends" className="underline">
            Trends
          </Link>{" "}
          page.
        </p>
      </Card>

      <Card title="Your details for targets">
        <p className="text-sm text-muted">Only what the energy formula needs: height, birth year (not your birthday) and, optionally, sex.</p>
        <ProfileForm
          heightCm={(prof?.height_cm as number | null | undefined) ?? null}
          birthYear={birthYear}
          sex={(prof?.sex as string | null | undefined) ?? null}
          goal={(prof?.nutrition_goal as string | undefined) ?? "maintain"}
        />
      </Card>

      {foods && foods.length > 0 && (
        <details className="rounded-lg border border-border bg-surface p-5">
          <summary className="cursor-pointer text-sm font-medium">Your saved foods ({foods.length})</summary>
          <ul className="mt-3 divide-y divide-border">
            {(foods as Array<{ id: number; name: string; brand: string | null; kcal_100g: number; source: string }>).map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className="min-w-0 truncate">
                  {f.name}
                  {f.brand && <span className="text-muted"> · {f.brand}</span>}
                  <span className="text-muted"> · {Math.round(f.kcal_100g)} kcal/100 g</span>
                </span>
                <form action={deleteFood}>
                  <input type="hidden" name="id" value={f.id} />
                  <button type="submit" className="text-xs text-muted underline">
                    Delete
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </details>
      )}

      <footer className="space-y-1 text-xs text-muted">
        <p>Product data from Open Food Facts (openfoodfacts.org), available under the Open Database License.</p>
        <p>General wellness information, not medical or dietary advice. If you have a medical condition, follow your clinician&rsquo;s advice.</p>
      </footer>
    </main>
  );
}

function Card({ title, tag, children }: { title: string; tag?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-lg border border-border bg-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-medium">{title}</h2>
        {tag}
      </div>
      {children}
    </section>
  );
}

function Bar({ label, eaten, target, unit }: { label: string; eaten: number; target: number; unit: string }) {
  const pct = target > 0 ? Math.min(100, (eaten / target) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted">
          <strong className="font-semibold text-foreground">{formatNumber(eaten)}</strong> of {formatNumber(target)} {unit}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-border" role="img" aria-label={`${label}: ${formatNumber(eaten)} of ${formatNumber(target)} ${unit}`}>
        <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Estimate({ confidence }: { confidence: number }) {
  const level = confidence >= 0.8 ? "high" : confidence >= 0.5 ? "medium" : "low";
  return <span className="text-xs text-muted">Estimate · {level} confidence</span>;
}
