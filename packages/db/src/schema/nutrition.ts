import { sql } from "drizzle-orm";
import { bigserial, check, date, index, pgTable, primaryKey, real, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, ownerPolicy, userId } from "./_shared";

/**
 * The user's saved foods: their own custom foods and products looked up on
 * Open Food Facts. Nutrients per 100 g (canonical units: kcal, g).
 */
export const foods = pgTable(
  "foods",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: userId(),
    name: text("name").notNull(),
    brand: text("brand"),
    barcode: text("barcode"),
    kcal100g: real("kcal_100g").notNull(),
    protein100g: real("protein_100g"),
    carbs100g: real("carbs_100g"),
    fat100g: real("fat_100g"),
    fibre100g: real("fibre_100g"),
    /** Typical serving in grams, when known. */
    servingG: real("serving_g"),
    source: text("source", { enum: ["custom", "off"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("foods_user_name_idx").on(t.userId, t.name),
    uniqueIndex("foods_user_barcode_uq").on(t.userId, t.barcode),
    check("foods_name_length", sql`char_length(${t.name}) between 1 and 120`),
    check("foods_nutrients_range", sql`${t.kcal100g} between 0 and 900 and coalesce(${t.protein100g}, 0) between 0 and 100 and coalesce(${t.carbs100g}, 0) between 0 and 100 and coalesce(${t.fat100g}, 0) between 0 and 100`),
    ownerPolicy("foods"),
  ],
).enableRLS();

/**
 * Food diary entries. Values are copied from the food when logged, so editing
 * or deleting a saved food never changes past days.
 */
export const foodLog = pgTable(
  "food_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: userId(),
    localDate: date("local_date").notNull(),
    meal: text("meal", { enum: ["breakfast", "lunch", "dinner", "snack"] }).notNull(),
    name: text("name").notNull(),
    grams: real("grams").notNull(),
    kcal: real("kcal").notNull(),
    proteinG: real("protein_g"),
    carbsG: real("carbs_g"),
    fatG: real("fat_g"),
    fibreG: real("fibre_g"),
    createdAt: createdAt(),
  },
  (t) => [
    index("food_log_user_date_idx").on(t.userId, t.localDate),
    check("food_log_grams_range", sql`${t.grams} > 0 and ${t.grams} <= 5000`),
    check("food_log_name_length", sql`char_length(${t.name}) between 1 and 160`),
    ownerPolicy("food_log"),
  ],
).enableRLS();

/** Body measurements entered in the app (Garmin weight has no mapper yet). One per day and source. */
export const bodyMeasurements = pgTable(
  "body_measurements",
  {
    userId: userId(),
    localDate: date("local_date").notNull(),
    source: text("source").notNull().default("manual"),
    weightKg: real("weight_kg").notNull(),
    bodyFatPct: real("body_fat_pct"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.localDate, t.source] }),
    check("body_measurements_weight_range", sql`${t.weightKg} between 20 and 400`),
    check("body_measurements_fat_range", sql`${t.bodyFatPct} is null or ${t.bodyFatPct} between 2 and 75`),
    ownerPolicy("body_measurements"),
  ],
).enableRLS();
