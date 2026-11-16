"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CodeInput } from "@/components/code-input";
import { createClient } from "@/lib/supabase/client";

type State =
  | { kind: "loading" }
  | { kind: "off" }
  | { kind: "enrolling"; factorId: string; qr: string; secret: string }
  | { kind: "on"; factorId: string }
  | { kind: "error"; message: string };

export function TwoStepSettings() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    createClient()
      .auth.mfa.listFactors()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) return setState({ kind: "error", message: "Couldn't load your settings." });
        const verified = data.totp.find((f) => f.status === "verified");
        setState(verified ? { kind: "on", factorId: verified.id } : { kind: "off" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function start() {
    setBusy(true);
    const supabase = createClient();
    // Clear any half-finished setup before starting a new one.
    const { data } = await supabase.auth.mfa.listFactors();
    for (const f of data?.all.filter((f) => f.status === "unverified") ?? []) {
      await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data: enrolled, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Authenticator app" });
    setBusy(false);
    if (error) return setState({ kind: "error", message: "Couldn't start setup. Try again." });
    setState({ kind: "enrolling", factorId: enrolled.id, qr: enrolled.totp.qr_code, secret: enrolled.totp.secret });
  }

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (state.kind !== "enrolling") return;
    setBusy(true);
    setMessage(undefined);
    const { error } = await createClient().auth.mfa.challengeAndVerify({ factorId: state.factorId, code });
    setBusy(false);
    if (error) return setMessage("That code didn't work. Try the next code from the app.");
    setCode("");
    setState({ kind: "on", factorId: state.factorId });
    router.refresh();
  }

  async function turnOff() {
    if (state.kind !== "on") return;
    setBusy(true);
    const { error } = await createClient().auth.mfa.unenroll({ factorId: state.factorId });
    setBusy(false);
    if (error) return setMessage("Couldn't turn it off. Sign out and back in, then try again.");
    setState({ kind: "off" });
    router.refresh();
  }

  const button = "rounded-md bg-accent px-3 py-2 font-medium text-accent-fg disabled:opacity-60";

  switch (state.kind) {
    case "loading":
      return <p className="text-sm text-muted">Loading…</p>;
    case "error":
      return <p className="text-sm text-danger">{state.message}</p>;
    case "off":
      return (
        <button type="button" onClick={start} disabled={busy} className={button}>
          Turn on two-step verification
        </button>
      );
    case "on":
      return (
        <div className="space-y-3">
          <p className="text-sm font-medium">Two-step verification is on.</p>
          <button type="button" onClick={turnOff} disabled={busy} className="text-sm text-danger underline">
            Turn it off
          </button>
          <p role="status" className="text-sm text-danger">
            {message}
          </p>
        </div>
      );
    case "enrolling":
      return (
        <form onSubmit={confirm} className="space-y-4 rounded-md border border-border bg-surface p-4">
          <p className="text-sm">
            Scan this with an authenticator app (for example Google Authenticator, 1Password or Apple Passwords), then
            enter the code it shows.
          </p>
          {/* Supabase returns the QR code as an SVG data URI. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={state.qr} alt="QR code for your authenticator app" className="mx-auto size-44 rounded bg-white p-2" />
          <p className="break-all text-xs text-muted">
            Can&rsquo;t scan? Enter this key: <code className="font-mono">{state.secret}</code>
          </p>
          <CodeInput value={code} onChange={setCode} />
          <button type="submit" disabled={busy || code.length !== 6} className={`w-full ${button}`}>
            {busy ? "Checking…" : "Turn on"}
          </button>
          <p role="status" aria-live="polite" className="min-h-5 text-sm text-danger">
            {message}
          </p>
        </form>
      );
  }
}
