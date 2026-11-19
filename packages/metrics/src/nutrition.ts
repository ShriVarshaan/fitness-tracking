import type { MetricResult } from "./common";

export type NutritionGoal = "lose" | "maintain" | "gain";

export interface NutritionInputs {
  weightKg: number | null;
  heightCm: number | null;
  /** Age in whole years (from birth year). */
  age: number | null;
  sex: "female" | "male" | null;
  goal: NutritionGoal;
  /** Garmin's total daily energy expenditure for recent complete days (kcal). */
  recentTotalKcal: number[];
  /** Training minutes over the last 7 days. */
  trainingMin7d: number;
  /** Sessions over the last 7 days. */
  sessions7d: number;
}

export interface NutritionTargets {
  /** Mifflin-St Jeor resting energy (kcal/day). */
  bmrKcal: number;
  /** Measured (Garmin, mean of recent days) or estimated expenditure. */
  expenditureKcal: number;
  expenditureSource: "garmin" | "estimate";
  energyKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** g/kg used, for the explanation. */
  proteinPerKg: number;
  carbsPerKg: number;
  /** Load band behind the carbohydrate figure. */
  loadBand: "light" | "moderate" | "high";
}

/** Days of Garmin expenditure needed before it replaces the estimate. */
export const EXPENDITURE_MIN_DAYS = 3;
/** Physical activity level for the fallback estimate (FAO/WHO/UNU 2004, sedentary-to-light). */
const FALLBACK_PAL = 1.4;
/** A moderate daily change: about 0.5 kg a week for loss. Never more. */
const DEFICIT_KCAL = 500;
const SURPLUS_KCAL = 300;

/**
 * Resting energy, Mifflin et al. 1990 (Am J Clin Nutr 51:241–247):
 * 10 × kg + 6.25 × cm − 5 × age + 5 (men) or − 161 (women). Without a recorded
 * sex the midpoint (− 78) is used and confidence is lower.
 */
export function mifflinStJeor(weightKg: number, heightCm: number, age: number, sex: "female" | "male" | null): number {
  const s = sex === "male" ? 5 : sex === "female" ? -161 : -78;
  return 10 * weightKg + 6.25 * heightCm - 5 * age + s;
}

const round5 = (v: number) => Math.round(v / 5) * 5;

/**
 * Daily energy and macronutrient targets.
 * Energy: Garmin's measured expenditure (mean of recent days, ≥ 3) or BMR × 1.4,
 * then − 500 kcal to lose or + 300 to gain, never below BMR.
 * Protein 1.2 g/kg, 1.6 with ≥ 3 sessions a week, + 0.2 when losing (max 2.0):
 * within the 1.2–2.0 g/kg range of Thomas, Erdman & Burke 2016 (J Acad Nutr Diet 116:501–528).
 * Carbohydrate by training volume (same source): < 30 min/day 3 g/kg, 30–60 min 5 g/kg, > 60 min 6 g/kg.
 * Fat: the remaining energy, at least 20% of energy (carbohydrate is reduced to keep it).
 * Heuristic choice of points within the published ranges; labelled as an estimate.
 */
export function nutritionTargets(i: NutritionInputs): MetricResult<NutritionTargets> {
  if (i.weightKg === null || !(i.weightKg > 0)) return { ok: false, reason: "needs your weight" };
  if (i.heightCm === null || !(i.heightCm > 0)) return { ok: false, reason: "needs your height" };
  if (i.age === null || !(i.age >= 16)) return { ok: false, reason: "needs your birth year (adults only)" };

  const bmr = mifflinStJeor(i.weightKg, i.heightCm, i.age, i.sex);
  const days = i.recentTotalKcal.filter((k) => k > 0);
  const measured = days.length >= EXPENDITURE_MIN_DAYS;
  const expenditure = measured ? days.reduce((a, b) => a + b, 0) / days.length : bmr * FALLBACK_PAL;
  const adjusted = i.goal === "lose" ? expenditure - DEFICIT_KCAL : i.goal === "gain" ? expenditure + SURPLUS_KCAL : expenditure;
  const energy = round5(Math.max(bmr, adjusted));

  let proteinPerKg = i.sessions7d >= 3 ? 1.6 : 1.2;
  if (i.goal === "lose") proteinPerKg = Math.min(2.0, proteinPerKg + 0.2);
  const perDay = i.trainingMin7d / 7;
  const loadBand = perDay > 60 ? "high" : perDay >= 30 ? "moderate" : "light";
  let carbsPerKg = loadBand === "high" ? 6 : loadBand === "moderate" ? 5 : 3;

  const protein = Math.round(i.weightKg * proteinPerKg);
  let carbs = Math.round(i.weightKg * carbsPerKg);
  const minFatKcal = energy * 0.2;
  let fatKcal = energy - protein * 4 - carbs * 4;
  if (fatKcal < minFatKcal) {
    carbs = Math.max(0, Math.round((energy - protein * 4 - minFatKcal) / 4));
    carbsPerKg = Math.round((carbs / i.weightKg) * 10) / 10;
    fatKcal = energy - protein * 4 - carbs * 4;
  }
  const fat = Math.round(fatKcal / 9);

  const confidence = (measured ? 1 : 0.6) * (i.sex ? 1 : 0.85);
  return {
    ok: true,
    confidence: Math.round(confidence * 100) / 100,
    bmrKcal: Math.round(bmr),
    expenditureKcal: Math.round(expenditure),
    expenditureSource: measured ? "garmin" : "estimate",
    energyKcal: energy,
    proteinG: protein,
    carbsG: carbs,
    fatG: fat,
    proteinPerKg,
    carbsPerKg,
    loadBand,
  };
}

/** Nutrients for `grams` of a food given per 100 g, rounded for display and storage. */
export function scaleNutrients(
  per100: { kcal: number; protein?: number | null; carbs?: number | null; fat?: number | null; fibre?: number | null },
  grams: number,
): { kcal: number; protein: number | null; carbs: number | null; fat: number | null; fibre: number | null } {
  const f = grams / 100;
  const r1 = (v: number | null | undefined) => (v == null ? null : Math.round(v * f * 10) / 10);
  return { kcal: Math.round(per100.kcal * f), protein: r1(per100.protein), carbs: r1(per100.carbs), fat: r1(per100.fat), fibre: r1(per100.fibre) };
}
