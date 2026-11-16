import type { Metadata } from "next";
import Link from "next/link";
import { AppNav } from "@/components/app-nav";
import { createClient } from "@/lib/supabase/server";
import { DeleteAccountForm, SleepNeedForm } from "./forms";

export const metadata: Metadata = { title: "Account" };
export const maxDuration = 60;

export default async function AccountPage() {
  const supabase = await createClient();
  const [{ data: auth }, { data: profile }] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.from("profile").select("sleep_need_min, privacy_accepted_at, privacy_version").maybeSingle(),
  ]);
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
