import { jsonb, pgTable, primaryKey, real, smallint, text, timestamp, date } from "drizzle-orm/pg-core";
import { ownerReadPolicy, userId } from "./_shared";

/**
 * Our own estimates (never Garmin's metrics), one row per user, day and metric.
 * `value` is null when there wasn't enough data; `components.reason` says why.
 */
export const derivedDaily = pgTable(
  "derived_daily",
  {
    userId: userId(),
    localDate: date("local_date").notNull(),
    metricCode: text("metric_code").notNull(),
    value: real("value"),
    components: jsonb("components").$type<Record<string, unknown>>().notNull().default({}),
    confidence: real("confidence").notNull().default(0),
    algoVersion: smallint("algo_version").notNull(),
    inputsHash: text("inputs_hash").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.localDate, t.metricCode] }), ownerReadPolicy("derived_daily")],
).enableRLS();
