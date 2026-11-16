import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
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

function daysUntil(date: string): number {
  return Math.ceil((Date.parse(`${date}T00:00:00Z`) - Date.now()) / 86_400_000);
}

export default async function GarminSettingsPage() {
  // Reads go through the user's own session, so RLS limits them to their rows.
  const supabase = await createClient();
  const [{ data: conn }, { data: jobs }] = await Promise.all([
    supabase
      .from("garmin_connection")
      .select("status, key_expires_on, backfill_complete, last_synced_at, last_error, updated_at")
      .maybeSingle(),
    supabase.from("sync_jobs").select("status, kind"),
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
