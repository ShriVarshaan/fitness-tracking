import { boolean, pgTable, text } from "drizzle-orm/pg-core";
import { authenticatedReadPolicy } from "./_shared";

/** Seeded from @ft/core METRICS. Reference data, read-only to the app. */
export const metricDefinitions = pgTable(
  "metric_definitions",
  {
    code: text("code").primaryKey(),
    label: text("label").notNull(),
    unit: text("unit").notNull(),
    kind: text("kind", { enum: ["instant", "interval", "daily"] }).notNull(),
    agg: text("agg", { enum: ["sum", "avg", "min", "max", "last"] }).notNull(),
    comparableGroup: text("comparable_group").notNull(),
    garminNative: boolean("garmin_native").notNull().default(false),
  },
  () => [authenticatedReadPolicy("metric_definitions")],
).enableRLS();
