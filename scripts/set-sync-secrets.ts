/**
 * One-off: store the app URL and CRON_SECRET in Supabase Vault so Supabase Cron
 * can call /api/sync/tick. Reads DATABASE_URL and CRON_SECRET from apps/web/.env.local.
 *
 *   pnpm sync:secrets https://your-app.vercel.app
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";

const appUrl = process.argv[2]?.replace(/\/$/, "");
if (!appUrl?.startsWith("https://")) {
  console.error("Usage: pnpm sync:secrets https://your-app.vercel.app");
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(new URL("../apps/web/.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
for (const k of ["DATABASE_URL", "CRON_SECRET"]) {
  if (!env[k]) {
    console.error(`${k} is missing from apps/web/.env.local`);
    process.exit(1);
  }
}

const sql = postgres(env.DATABASE_URL!, { prepare: false, max: 1 });
try {
  await sql`select private.set_secret('app_url', ${appUrl})`;
  await sql`select private.set_secret('cron_secret', ${env.CRON_SECRET!})`;
  const [job] = await sql`select schedule from cron.job where jobname = 'garmin-sync-tick'`;
  console.log(`Saved app_url and cron_secret in Vault. Cron schedule: ${job?.schedule ?? "not found"}`);
} finally {
  await sql.end();
}
