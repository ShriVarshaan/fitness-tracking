import "server-only";
import { sql } from "drizzle-orm";
import type { Db } from "@ft/db";

/** Vault secret names, one set per user. */
export const secretName = {
  apiKey: (userId: string) => `garmin_api_key:${userId}`,
  accessToken: (userId: string) => `garmin_access_token:${userId}`,
};

export async function setSecret(db: Db, name: string, value: string): Promise<void> {
  await db.execute(sql`select private.set_secret(${name}, ${value})`);
}

export async function getSecret(db: Db, name: string): Promise<string | null> {
  const rows = await db.execute<{ value: string | null }>(sql`select private.get_secret(${name}) as value`);
  return rows[0]?.value ?? null;
}

export async function deleteSecret(db: Db, name: string): Promise<void> {
  await db.execute(sql`select private.delete_secret(${name})`);
}
