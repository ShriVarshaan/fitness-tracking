import { describe, expect, it } from "vitest";
import { mifflinStJeor, nutritionTargets, scaleNutrients, type NutritionInputs } from "./nutrition";

const base: NutritionInputs = {
  weightKg: 70,
  heightCm: 175,
  age: 30,
  sex: "male",
  goal: "maintain",
  recentTotalKcal: [2600, 2500, 2700],
  trainingMin7d: 280, // 40 min/day → moderate
  sessions7d: 4,
};

describe("mifflinStJeor", () => {
  it("matches hand-computed values", () => {
    // 10×70 + 6.25×175 − 5×30 + 5 = 700 + 1093.75 − 150 + 5 = 1648.75
    expect(mifflinStJeor(70, 175, 30, "male")).toBe(1648.75);
    // 10×60 + 6.25×165 − 5×40 − 161 = 600 + 1031.25 − 200 − 161 = 1270.25
    expect(mifflinStJeor(60, 165, 40, "female")).toBe(1270.25);
    expect(mifflinStJeor(70, 175, 30, null)).toBe(1648.75 - 83);
  });
});

describe("nutritionTargets", () => {
  it("uses Garmin's expenditure and scales macros to training", () => {
    const r = nutritionTargets(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Expenditure mean 2600; maintain. Protein 1.6 × 70 = 112 g; carbs 5 × 70 = 350 g;
    // fat (2600 − 448 − 1400) / 9 = 752 / 9 = 83.6 → 84 g.
    expect(r).toMatchObject({
      bmrKcal: 1649,
      expenditureKcal: 2600,
      expenditureSource: "garmin",
      energyKcal: 2600,
      proteinG: 112,
      carbsG: 350,
      fatG: 84,
      loadBand: "moderate",
      confidence: 1,
    });
  });

  it("loses at a moderate 500 kcal a day, never below resting energy, with more protein", () => {
    const r = nutritionTargets({ ...base, goal: "lose" });
    expect(r.ok && r.energyKcal).toBe(2100);
    expect(r.ok && r.proteinPerKg).toBe(1.8);
    // Low expenditure: 1,900 − 500 = 1,400 is below BMR 1,649 → BMR rounded to 5 = 1,650.
    const low = nutritionTargets({ ...base, goal: "lose", recentTotalKcal: [1900, 1900, 1900] });
    expect(low.ok && low.energyKcal).toBe(1650);
  });

  it("keeps fat at 20% of energy or more by trimming carbohydrate", () => {
    // High volume (90 min/day → 6 g/kg = 420 g) on 2,400 kcal: protein 448 + carbs 1,680 leaves 272 < 480.
    const r = nutritionTargets({ ...base, recentTotalKcal: [2400, 2400, 2400], trainingMin7d: 630 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // carbs = (2400 − 448 − 480) / 4 = 368 g; fat = 480 / 9 = 53 g.
    expect([r.carbsG, r.fatG, r.loadBand]).toEqual([368, 53, "high"]);
  });

  it("falls back to BMR × 1.4 with lower confidence, and needs weight, height and age", () => {
    const r = nutritionTargets({ ...base, recentTotalKcal: [2500, 0], sex: null, sessions7d: 0, trainingMin7d: 0 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // BMR 1565.75 × 1.4 = 2192.05 → 2190; light: 3 g/kg; protein 1.2 g/kg.
    expect([r.expenditureSource, r.energyKcal, r.carbsG, r.proteinG]).toEqual(["estimate", 2190, 210, 84]);
    expect(r.confidence).toBe(0.51);
    expect(nutritionTargets({ ...base, weightKg: null })).toEqual({ ok: false, reason: "needs your weight" });
    expect(nutritionTargets({ ...base, heightCm: null })).toEqual({ ok: false, reason: "needs your height" });
    expect(nutritionTargets({ ...base, age: 15 })).toEqual({ ok: false, reason: "needs your birth year (adults only)" });
  });
});

describe("scaleNutrients", () => {
  it("scales per-100 g values to a portion", () => {
    expect(scaleNutrients({ kcal: 389, protein: 16.9, carbs: 66.3, fat: 6.9, fibre: null }, 45)).toEqual({
      kcal: 175,
      protein: 7.6,
      carbs: 29.8,
      fat: 3.1,
      fibre: null,
    });
  });
});
