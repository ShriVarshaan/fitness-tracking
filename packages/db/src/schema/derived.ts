import { bigserial, boolean, date, index, jsonb, pgTable, primaryKey, real, smallint, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
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
    /** Web Push: what was last notified for this row (the date, or the activity for post-workout), and when. */
    pushedKey: text("pushed_key"),
    pushedAt: timestamp("pushed_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind, t.forDate] }), ownerReadPolicy("insights")],
).enableRLS();

/** Chat history: questions, answers, which read-only tools were used and whether numbers were verified. */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: userId(),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    toolsUsed: text("tools_used").array().notNull().default([]),
    /** Assistant only: every number traced to tool results (null for user messages and fixed replies). */
    grounded: boolean("grounded"),
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("chat_messages_user_created_idx").on(t.userId, t.createdAt), ownerReadPolicy("chat_messages")],
).enableRLS();

/**
 * Web Push subscriptions, one per browser or device. The endpoint belongs to the
 * browser's push service (Google, Apple, Mozilla); payloads are encrypted end to end.
 * Written only by server code after checking the session.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: userId(),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    /** Short device description for the settings list, e.g. "Chrome on Android". */
    device: text("device"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    failures: smallint("failures").notNull().default(0),
  },
  (t) => [uniqueIndex("push_subscriptions_endpoint_uq").on(t.endpoint), index("push_subscriptions_user_idx").on(t.userId), ownerReadPolicy("push_subscriptions")],
).enableRLS();
