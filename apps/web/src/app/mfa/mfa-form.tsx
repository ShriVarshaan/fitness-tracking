"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CodeInput } from "@/components/code-input";
import { createClient } from "@/lib/supabase/client";

/** Second sign-in step for accounts that have two-step verification turned on. */
export function MfaForm() {
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    createClient()
      .auth.mfa.listFactors()
      .then(({ data, error }) => {
        const verified = data?.totp.find((f) => f.status === "verified");
        if (error || !verified) setLoadError(true);
        else setFactorId(verified.id);
      });
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true);
    setMessage(undefined);
    const { error } = await createClient().auth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (error) {
      setMessage("That code didn't work. Check the time on your phone and try the next code.");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  async function signOut() {
    await createClient().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  if (loadError) return <p className="text-sm text-danger">Couldn&rsquo;t load your sign-in settings. Try signing in again.</p>;
  if (!factorId) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <CodeInput value={code} onChange={setCode} />
      <button
        type="submit"
        disabled={busy || code.length !== 6}
        className="w-full rounded-md bg-accent px-3 py-2 font-medium text-accent-fg disabled:opacity-60"
      >
        {busy ? "Checking…" : "Verify"}
      </button>
      <p role="status" aria-live="polite" className="min-h-5 text-sm text-danger">
        {message}
      </p>
      <button type="button" onClick={signOut} className="text-sm text-muted underline">
        Sign out
      </button>
    </form>
  );
}
