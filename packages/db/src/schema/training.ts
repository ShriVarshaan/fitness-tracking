import { sql } from "drizzle-orm";
import { bigint, bigserial, check, date, index, integer, jsonb, pgTable, real, text } from "drizzle-orm/pg-core";
import { createdAt, ownerPolicy, userId } from "./_shared";

/** A training plan made from a template, or by hand. Plans live in the app (pushing to the watch needs Garmin Starter). */
export const trainingPlans = pgTable(
  "training_plans",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: userId(),
    name: text("name").notNull(),
    /** Template key it was made from, or null. */
    template: text("template"),
    startDate: date("start_date").notNull(),
    createdAt: createdAt(),
  },
  (t) => [check("training_plans_name_length", sql`char_length(${t.name}) between 1 and 80`), ownerPolicy("training_plans")],
).enableRLS();

/** One step of a structured workout (the workout builder). */
export interface WorkoutStep {
  kind: "warmup" | "work" | "recover" | "cooldown";
  /** Seconds, or metres when `distanceM` is set instead. */
  durationS?: number | null;
  distanceM?: number | null;
  /** Free text target, e.g. "easy, conversational" or "5K pace". */
  target?: string | null;
  /** Repeat this step (with the following recover step) n times. */
  repeat?: number | null;
}

export const plannedWorkouts = pgTable(
  "planned_workouts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: userId(),
    planId: bigint("plan_id", { mode: "number" }).references(() => trainingPlans.id, { onDelete: "cascade" }),
    localDate: date("local_date").notNull(),
    sport: text("sport", { enum: ["running", "cycling", "swimming", "strength", "walking", "other"] }).notNull(),
    title: text("title").notNull(),
    intensity: text("intensity", { enum: ["easy", "moderate", "hard", "long"] }).notNull(),
    targetDurationS: integer("target_duration_s"),
    targetDistanceM: real("target_distance_m"),
    steps: jsonb("steps").$type<WorkoutStep[]>().notNull().default([]),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [
    index("planned_workouts_user_date_idx").on(t.userId, t.localDate),
    check("planned_workouts_title_length", sql`char_length(${t.title}) between 1 and 80`),
    check("planned_workouts_targets_range", sql`coalesce(${t.targetDurationS}, 0) between 0 and 86400 and coalesce(${t.targetDistanceM}, 0) between 0 and 500000`),
    check("planned_workouts_steps_size", sql`jsonb_array_length(${t.steps}) <= 30`),
    check("planned_workouts_notes_length", sql`${t.notes} is null or char_length(${t.notes}) <= 500`),
    ownerPolicy("planned_workouts"),
  ],
).enableRLS();
