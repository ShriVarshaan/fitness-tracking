import { boolean, integer, pgTable, real, smallint, text } from "drizzle-orm/pg-core";
import { createdAt, ownerPolicy, updatedAt, userId } from "./_shared";

export const profile = pgTable(
  "profile",
  {
    userId: userId().primaryKey(),
    displayName: text("display_name"),
    timezone: text("timezone").notNull().default("Europe/London"),
    /** Birth year only, never full date of birth (minimisation). */
    birthYear: smallint("birth_year"),
    /** Optional; only used to pick sex-specific formula constants. */
    sex: text("sex", { enum: ["female", "male"] }),
    heightCm: real("height_cm"),
    units: text("units", { enum: ["metric", "imperial"] }).notNull().default("metric"),
    sleepNeedMin: integer("sleep_need_min").notNull().default(480),
    aiEnabled: boolean("ai_enabled").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [ownerPolicy("profile")],
).enableRLS();

export const userPhysiology = pgTable(
  "user_physiology",
  {
    userId: userId().primaryKey(),
    hrMax: smallint("hr_max"),
    hrMaxSource: text("hr_max_source", { enum: ["measured", "estimated", "override"] }),
    hrRestBaseline: smallint("hr_rest_baseline"),
    lthr: smallint("lthr"),
    ftpW: smallint("ftp_w"),
    thresholdPaceSPerKm: real("threshold_pace_s_per_km"),
    zoneModel: text("zone_model", { enum: ["hrr", "hrmax", "lthr"] }).notNull().default("hrr"),
    updatedAt: updatedAt(),
  },
  () => [ownerPolicy("user_physiology")],
).enableRLS();

export type ProfileRow = typeof profile.$inferSelect;
