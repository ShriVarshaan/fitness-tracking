import type { Metadata } from "next";
import { AppNav } from "@/components/app-nav";
import { PendingButton } from "@/app/settings/garmin/pending-button";
import { getDb } from "@/server/db";
import { importedCounts } from "@/server/imports";
import { requireUserId } from "@/server/session";
import { deleteAppleHealthData } from "./actions";
import { Importer } from "./importer";

export const metadata: Metadata = { title: "Import" };

export default async function ImportPage() {
  const userId = await requireUserId();
  const apple = (await importedCounts(getDb(), userId)).apple_health;
  const hasApple = apple.days + apple.nights + apple.activities > 0;

  return (
    <main className="mx-auto w-full max-w-xl flex-1 space-y-6 px-4 py-8 sm:py-10">
      <AppNav current="/settings/import" />
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Import history</h1>
        <p className="text-sm text-muted">
          Files are read on this device. Only the daily totals, nights and workouts taken from them are sent, never the file
          itself. Importing the same file again updates rows rather than duplicating them. Imported data replaces demo data.
        </p>
      </div>

      <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
        <h2 className="font-medium">Garmin account export</h2>
        <p className="text-sm text-muted">
          For history older than the year the Garmin key loads. On garmin.com, open Account → Data management → Export your
          data; Garmin emails a link to a ZIP. Choose that ZIP here.
        </p>
        <p className="text-sm text-muted">
          Reads daily summaries, sleep and activities. Where the Garmin key has already loaded a day, night or activity,
          that copy is kept. Activity charts aren&rsquo;t in the export; for activities from the last year they are
          downloaded through your Garmin key while it is connected.
        </p>
        <Importer source="garmin_export" accept=".zip,application/zip" />
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
        <h2 className="font-medium">Apple Health</h2>
        <p className="text-sm text-muted">
          On iPhone, open Health → your picture → Export All Health Data, and save export.zip to Files. Choose the ZIP (or
          export.xml from inside it) here.
        </p>
        <p className="text-sm text-muted">
          Reads steps, distance, energy, flights climbed, resting heart rate, sleep stages, workouts, weight, body fat and
          Apple&rsquo;s VO2 max estimate. Garmin data wins on any day, night or workout that both have. Apple&rsquo;s HRV
          isn&rsquo;t imported: it measures a different thing (SDNN) from Garmin&rsquo;s overnight HRV (RMSSD).
        </p>
        <Importer source="apple_health" accept=".zip,.xml,application/zip,text/xml" />
        {hasApple && (
          <form action={deleteAppleHealthData} className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <p className="text-sm text-muted">
              Stored from Apple Health: {apple.days.toLocaleString("en-GB")} days, {apple.nights.toLocaleString("en-GB")} nights,{" "}
              {apple.activities.toLocaleString("en-GB")} workouts.
            </p>
            <PendingButton idle="Delete Apple Health data" pending="Deleting…" variant="danger" />
          </form>
        )}
      </section>

      <p className="text-xs text-muted">General wellness information, not medical advice.</p>
    </main>
  );
}
