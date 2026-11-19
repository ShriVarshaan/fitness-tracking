import type { Metadata } from "next";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { createClient } from "@/lib/supabase/server";
import { aiAvailable } from "@/server/ai";
import { schema } from "@ft/db";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { requireUserId } from "@/server/session";
import { AiWordingForm, DeleteAccountForm, SleepNeedForm } from "./forms";
import { removePushDevice } from "./push-actions";
import { PushSettings } from "./push-settings";

export const metadata: Metadata = { title: "Account" };
export const maxDuration = 60;

export default async function AccountPage() {
  const supabase = await createClient();
  const userId = await requireUserId();
  const [{ data: auth }, { data: profile }, devices] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.from("profile").select("sleep_need_min, privacy_accepted_at, privacy_version, ai_enabled, ai_consented_at, push_kinds").maybeSingle(),
    // Only the label and date; the endpoint and keys never leave the server.
    getDb()
      .select({ id: schema.pushSubscriptions.id, device: schema.pushSubscriptions.device, createdAt: schema.pushSubscriptions.createdAt })
      .from(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.userId, userId)),
  ]);
  // Opt-out: no profile row yet means the default, which is on.
  const aiOn = profile ? Boolean(profile.ai_enabled) : true;
  const email = typeof auth?.claims.email === "string" ? auth.claims.email : null;

  return (
    <main className="mx-auto w-full max-w-xl flex-1 space-y-8 px-4 py-8 sm:py-10">
      <header className="space-y-3">
        <AppNav current="/settings/account" />
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="text-sm text-muted">{email}</p>
      </header>

      <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
        <h2 className="font-medium">Sleep need</h2>
        <p className="text-sm text-muted">Used for sleep debt and the sleep part of readiness. Most adults need 7–9 hours.</p>
        <SleepNeedForm current={profile?.sleep_need_min ?? 480} />
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
        <h2 className="font-medium">Notifications</h2>
        <p className="text-sm text-muted">
          Get your morning summary, evening check-in, workout and weekly summaries as notifications. Each shows the
          summary&rsquo;s headline, which may be visible on your lock screen. They&rsquo;re sent between 07:00 and 22:00, and are
          encrypted so the browser&rsquo;s push service (Google, Apple or Mozilla) can&rsquo;t read them.
        </p>
        <PushSettings
          publicKey={process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null}
          kinds={(profile?.push_kinds as string[] | undefined) ?? ["morning", "post_workout", "evening", "weekly"]}
        />
        {devices.length > 0 && (
          <div className="space-y-1 border-t border-border pt-3">
            <p className="text-sm font-medium">Devices</p>
            <ul className="space-y-1">
              {devices.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    {d.device ?? "Browser"} <span className="text-muted">· since {d.createdAt.toLocaleDateString("en-GB")}</span>
                  </span>
                  <form action={removePushDevice}>
                    <input type="hidden" name="id" value={d.id} />
                    <button type="submit" className="text-sm text-muted underline">
                      Remove
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
        <h2 className="font-medium">AI wording</h2>
        <p className="text-sm text-muted">
          Your summaries are always worked out by fixed rules from your numbers. With this on, an AI model
          rewrites the wording only, using the numbers behind the summary (no name or email), which are sent to
          Google&rsquo;s Gemini API. Its text is checked against your numbers before it&rsquo;s shown, and the standard wording is used if it
          fails. Health warnings are never sent to the model. It&rsquo;s on by default; you can turn it off here at any time.
        </p>
        <p className="text-sm">
          Currently: <strong className="font-semibold">{aiOn ? "on" : "off"}</strong>
          {aiOn && profile?.ai_consented_at && (
            <span className="text-muted"> (since {new Date(profile.ai_consented_at).toLocaleDateString("en-GB")})</span>
          )}
        </p>
        <AiWordingForm enabled={aiOn} available={aiAvailable()} />
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-surface p-5">
        <h2 className="font-medium">Your data</h2>
        <p className="text-sm text-muted">
          Download everything stored for your account as a JSON file. Your Garmin key isn&rsquo;t included.
        </p>
        <a href="/api/export" className="inline-block rounded-md border border-border px-3 py-2 text-sm font-medium" download>
          Download my data
        </a>
        <p className="text-xs text-muted">
          {profile?.privacy_accepted_at
            ? `You agreed to the privacy notice (version ${profile.privacy_version}) on ${new Date(profile.privacy_accepted_at).toLocaleDateString("en-GB")}.`
            : "No consent recorded for this account yet."}{" "}
          <Link href="/privacy" className="underline">
            Read the privacy notice
          </Link>
        </p>
      </section>

      <section className="space-y-3 rounded-lg border border-danger/40 p-5">
        <h2 className="font-medium text-danger">Delete account</h2>
        <p className="text-sm text-muted">
          Permanently deletes your login, your Garmin key and all of your data. This can&rsquo;t be undone. To stop syncing
          but keep your data, remove your key on the{" "}
          <Link href="/settings/garmin" className="underline">
            Garmin page
          </Link>{" "}
          instead.
        </p>
        <DeleteAccountForm />
      </section>
    </main>
  );
}
