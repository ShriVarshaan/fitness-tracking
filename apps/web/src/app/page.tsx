import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./sign-out-button";

export default async function TodayPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims.email === "string" ? data.claims.email : null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-8 px-4 py-10">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
        <div className="flex min-w-0 items-center gap-3 text-sm text-muted">
          <span className="truncate">{email}</span>
          <Link href="/settings/security" className="underline">
            Security
          </Link>
          <SignOutButton />
        </div>
      </header>

      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="font-medium">Garmin isn&rsquo;t connected yet</h2>
        <p className="mt-1 text-sm text-muted">
          Add your Garmin Personal API key to load your history. Charts and insights arrive in the next build step.
        </p>
        <Link href="/settings/garmin" className="mt-3 inline-block text-sm font-medium underline">
          Garmin settings
        </Link>
      </section>

      <footer className="text-xs text-muted">General wellness information, not medical advice.</footer>
    </main>
  );
}
