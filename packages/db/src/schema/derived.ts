import { boolean, date, jsonb, pgTable, primaryKey, real, smallint, text, timestamp } from "drizzle-orm/pg-core";
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

/** Output of the rules layer, one row per user, day and rule. */
export const findings = pgTable(
  "findings",
  {
    userId: userId(),
    localDate: date("local_date").notNull(),
    ruleId: text("rule_id").notNull(),
    ruleVersion: smallint("rule_version").notNull(),
    severity: text("severity", { enum: ["info", "caution", "red_flag"] }).notNull(),
    confidence: real("confidence").notNull(),
    evidence: jsonb("evidence").$type<unknown[]>().notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.localDate, t.ruleId] }), ownerReadPolicy("findings")],
).enableRLS();

/** Written insights (template now; optional LLM wording later). */
export const insights = pgTable(
  "insights",
  {
    userId: userId(),
    kind: text("kind", { enum: ["morning", "post_workout", "evening", "weekly"] }).notNull(),
    forDate: date("for_date").notNull(),
    body: jsonb("body").$type<Record<string, unknown>>().notNull(),
    ruleIds: text("rule_ids").array().notNull(),
    model: text("model").notNull(),
    validatorOk: boolean("validator_ok").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind, t.forDate] }), ownerReadPolicy("insights")],
).enableRLS();
