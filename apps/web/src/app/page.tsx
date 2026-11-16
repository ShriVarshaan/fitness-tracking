import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "./sign-out-button";

export default async function TodayPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const email = typeof data?.claims.email === "string" ? data.claims.email : null;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-8 px-4 py-10">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
        <div className="flex items-center gap-3 text-sm text-muted">
          <span className="truncate">{email}</span>
          <SignOutButton />
        </div>
      </header>

      <section className="rounded-lg border border-border bg-surface p-5">
        <h2 className="font-medium">Garmin isn&rsquo;t connected yet</h2>
        <p className="mt-1 text-sm text-muted">
          The Garmin API key box arrives in the next build phase. Once your key is saved, your data will appear here.
        </p>
      </section>

      <footer className="text-xs text-muted">General wellness information, not medical advice.</footer>
    </main>
  );
}
