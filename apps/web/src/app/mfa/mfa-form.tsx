"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Phase =
  | { kind: "loading" }
  | { kind: "enroll"; factorId: string; qr: string; secret: string }
  | { kind: "verify"; factorId: string }
  | { kind: "error"; message: string };

export function MfaForm() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) return setPhase({ kind: "error", message: "Couldn't load your sign-in settings." });

      const verified = data.totp.find((f) => f.status === "verified");
      if (verified) {
        if (!cancelled) setPhase({ kind: "verify", factorId: verified.id });
        return;
      }

      // First sign-in: clear any half-finished setup, then enrol a new authenticator.
      for (const f of data.all.filter((f) => f.status === "unverified")) {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const enrolled = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Authenticator app" });
      if (enrolled.error) return setPhase({ kind: "error", message: "Couldn't start authenticator setup." });
      if (!cancelled) {
        setPhase({
          kind: "enroll",
          factorId: enrolled.data.id,
          qr: enrolled.data.totp.qr_code,
          secret: enrolled.data.totp.secret,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (phase.kind !== "enroll" && phase.kind !== "verify") return;
    setBusy(true);
    setMessage(undefined);
    const supabase = createClient();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: phase.factorId, code: code.trim() });
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
  }

  if (phase.kind === "loading") return <p className="text-sm text-muted">Loading…</p>;
  if (phase.kind === "error") return <p className="text-sm text-danger">{phase.message}</p>;

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {phase.kind === "enroll" && (
        <div className="space-y-3 rounded-md border border-border p-4">
          <p className="text-sm">
            Scan this with an authenticator app (for example Google Authenticator, 1Password or Apple Passwords).
          </p>
          {/* Supabase returns the QR code as an SVG data URI. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={phase.qr} alt="QR code for your authenticator app" className="mx-auto size-44 rounded bg-white p-2" />
          <p className="break-all text-xs text-muted">
            Can&rsquo;t scan? Enter this key: <code className="font-mono">{phase.secret}</code>
          </p>
        </div>
      )}
      <label htmlFor="code" className="block text-sm font-medium">
        6-digit code
      </label>
      <input
        id="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        className="w-full rounded-md border border-border bg-surface px-3 py-2 font-mono tracking-widest outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
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
