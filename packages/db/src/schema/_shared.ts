import { sql } from "drizzle-orm";
import { pgPolicy, timestamp, uuid } from "drizzle-orm/pg-core";
import { authUid, authenticatedRole, authUsers } from "drizzle-orm/supabase";

/** Owner column: every user-scoped table references the Supabase Auth user. */
export const userId = () =>
  uuid("user_id")
    .notNull()
    .references(() => authUsers.id, { onDelete: "cascade" });

export const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/**
 * RLS: the logged-in owner can read and write their own rows; anon gets nothing.
 * Server-side sync code connects as a privileged role and filters by user explicitly.
 */
export const ownerPolicy = (table: string) =>
  pgPolicy(`${table}_owner_all`, {
    as: "permissive",
    for: "all",
    to: authenticatedRole,
    using: sql`${authUid} = user_id`,
    withCheck: sql`${authUid} = user_id`,
  });

/** Read-only for logged-in users (reference data such as the metric registry). */
export const authenticatedReadPolicy = (table: string) =>
  pgPolicy(`${table}_authenticated_read`, {
    as: "permissive",
    for: "select",
    to: authenticatedRole,
    using: sql`true`,
  });
