import "server-only";
import { createDb, type Db } from "@ft/db";

let db: Db | undefined;

/**
 * Privileged database connection (bypasses RLS). Only for trusted server code;
 * every query must filter by a user id taken from the verified session.
 */
export function getDb(): Db {
  if (!db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    db = createDb(url);
  }
  return db;
}
