import type { Metadata } from "next";
import Link from "next/link";
import { ALL_DATA_TYPES } from "@ft/garmin";
import { formatDay, titleCase } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { getDb } from "@/server/db";
import { requireUserId } from "@/server/session";
import { DATABASE_LIMIT_BYTES, formatBytes, storageUsage } from "@/server/storage";
import { removeGarminKey, syncNow } from "./actions";
import { KeyForm } from "./key-form";
import { PendingButton } from "./pending-button";

export const metadata: Metadata = { title: "Garmin" };
// "Sync now" runs up to ~25 s of sync work inside the server action.
export const maxDuration = 60;

const STATUS_TEXT = {
  active: "Connected",
  key_invalid: "Key rejected by Garmin",
  key_expired: "Key expired",
  removed: "Not connected",
} as const;

const DATA_TYPE_LABEL: Record<string, string> = {
  daily_summaries: "Daily summaries",
  sleep: "Sleep",
  hrv: "HRV",
  vo2max: "VO2 max",
  weight: "Weight",
  activities: "Activities",
  activity_file: "Activity files",
};

function daysUntil(date: string): number {
  return Math.ceil((Date.parse(`${date}T00:00:00Z`) - Date.now()) / 86_400_000);
}

export default async function GarminSettingsPage() {
  // Reads go through the user's own session, so RLS limits them to their rows.
  const supabase = await createClient();
  const userId = await requireUserId();
  const [{ data: conn }, { data: jobs }, { data: failed }, { data: quarantined }, storage] = await Promise.all([
    supabase
      .from("garmin_connection")
      .select("status, key_expires_on, backfill_complete, last_synced_at, last_error, updated_at")
      .maybeSingle(),
    supabase.from("sync_jobs").select("status, kind"),
    supabase
      .from("sync_jobs")
      .select("id, data_type, range_from, range_to, attempts, error, updated_at")
      .eq("status", "failed")
      .order("updated_at", { ascending: false })
      .limit(10),
    // Never the payload: only what failed and why.
    supabase
      .from("raw_ingest")
      .select("id, endpoint, received_at, error")
      .not("error", "is", null)
      .order("received_at", { ascending: false })
      .limit(10),
    // Privileged size query, filtered by the verified user id.
    storageUsage(getDb(), userId).catch(() => null),
  ]);

  const counts = { queued: 0, running: 0, done: 0, failed: 0 };
  let backfillTotal = 0;
  let backfillDone = 0;
  for (const j of jobs ?? []) {
    counts[j.status as keyof typeof counts]++;
    if (j.kind === "backfill") {
      backfillTotal++;
      if (j.status === "done") backfillDone++;
    }
  }

  const status = (conn?.status ?? "removed") as keyof typeof STATUS_TEXT;
  const connected = status === "active";
  const expiresIn = conn?.key_expires_on ? daysUntil(conn.key_expires_on) : null;
  const lastSynced = conn?.last_synced_at as Record<string, string> | undefined;
  const newest = lastSynced ? Object.values(lastSynced).sort().at(-1) : undefined;

  return (
    <main className="mx-auto w-full max-w-xl flex-1 space-y-8 px-4 py-10">
      <Link href="/" className="text-sm text-muted underline">
        ← Today
      </Link>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Garmin</h1>
        <p className="text-sm text-muted">
          Connect with your own Garmin Personal API key. It&rsquo;s stored encrypted and never shown again.
        </p>
      </div>

      {conn && status !== "removed" && (
        <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="font-medium">{STATUS_TEXT[status]}</h2>
            {expiresIn !== null && (
              <span className={`text-sm ${expiresIn <= 14 ? "text-danger" : "text-muted"}`}>
                {expiresIn > 0 ? `Key expires in ${expiresIn} day${expiresIn === 1 ? "" : "s"}` : "Key expired"}
              </span>
            )}
          </div>
          {conn.last_error && <p className="text-sm text-danger">{conn.last_error}</p>}
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted">History</dt>
            <dd>
              {conn.backfill_complete
                ? "Loaded"
                : backfillTotal > 0
                  ? `Loading… ${Math.round((backfillDone / backfillTotal) * 100)}%`
                  : "Waiting"}
            </dd>
            <dt className="text-muted">Newest data</dt>
            <dd>{newest ?? "None yet"}</dd>
            <dt className="text-muted">Sync jobs</dt>
            <dd>
              {counts.done} done · {counts.queued + counts.running} waiting
              {counts.failed > 0 && <span className="text-danger"> · {counts.failed} failed</span>}
            </dd>
          </dl>
          <div className="flex flex-wrap gap-3 pt-2">
            {connected && (
              <form action={syncNow}>
                <PendingButton idle="Sync now" pending="Syncing…" />
              </form>
            )}
            <form action={removeGarminKey}>
              <PendingButton idle="Remove key" pending="Removing…" variant="danger" />
            </form>
          </div>
        </section>
      )}

      {conn && status !== "removed" && (
        <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
          <h2 className="font-medium">Sync details</h2>
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            {ALL_DATA_TYPES.map((t) => (
              <div key={t} className="contents">
                <dt className="text-muted">{DATA_TYPE_LABEL[t] ?? titleCase(t)}</dt>
                <dd>{lastSynced?.[t] ? `Up to ${formatDay(lastSynced[t]!.slice(0, 10))}` : "Not yet"}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted">Each sync re-fetches the last two days, because Garmin revises recent days.</p>

          <h3 className="pt-2 text-sm font-medium">Problems</h3>
          {!failed?.length && !quarantined?.length ? (
            <p className="text-sm text-muted">None. Every sync job finished and every Garmin response passed its checks.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {(failed ?? []).map((j) => (
                <li key={`job-${j.id}`}>
                  <span className="text-danger">Failed</span> · {DATA_TYPE_LABEL[j.data_type] ?? titleCase(j.data_type)},{" "}
                  {formatDay(String(j.range_from).slice(0, 10))} to {formatDay(String(j.range_to).slice(0, 10))} after {j.attempts} attempt
                  {j.attempts === 1 ? "" : "s"}
                  {j.error && <span className="block text-xs text-muted">{String(j.error).slice(0, 200)}</span>}
                </li>
              ))}
              {(quarantined ?? []).map((r) => {
                const unmapped = String(r.error).startsWith("unmapped");
                return (
                  <li key={`raw-${r.id}`}>
                    <span className={unmapped ? "text-muted" : "text-danger"}>{unmapped ? "Not stored yet" : "Quarantined"}</span> ·{" "}
                    {titleCase(r.endpoint)}, received {formatDay(String(r.received_at).slice(0, 10))}
                    <span className="block text-xs text-muted">
                      {unmapped
                        ? "The app can't read this kind of data yet. It is kept for 30 days in case a future version can."
                        : `Garmin sent data in a shape the app didn't expect, so it was kept aside instead of guessed at (${String(r.error).slice(0, 160)}).`}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {storage && storage.userBytes > 0 && (
        <section className="space-y-2 rounded-lg border border-border bg-surface p-5">
          <h2 className="font-medium">Storage</h2>
          <p className="text-sm">
            Your data takes about <strong className="font-semibold">{formatBytes(storage.userBytes)}</strong>.
          </p>
          <div className="h-1.5 overflow-hidden rounded-full bg-border" role="img" aria-label={`Database ${Math.round((storage.databaseBytes / DATABASE_LIMIT_BYTES) * 100)}% full`}>
            <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.min(100, (storage.databaseBytes / DATABASE_LIMIT_BYTES) * 100)}%` }} />
          </div>
          <p className="text-xs text-muted">
            The whole database (every account, plus indexes) uses {formatBytes(storage.databaseBytes)} of the free plan&rsquo;s{" "}
            {formatBytes(DATABASE_LIMIT_BYTES)}. Per-second activity data takes most of it.
          </p>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="font-medium">{connected ? "Replace your key" : "Add your key"}</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>In Garmin Connect on the web, open your account settings and find the Personal API key page.</li>
          <li>Accept the terms, choose how long the key lasts, and create it.</li>
          <li>Copy the key straight away (Garmin shows it only once) and paste it below.</li>
        </ol>
        <KeyForm />
      </section>
    </main>
  );
}
