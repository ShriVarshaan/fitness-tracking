import type { Metadata } from "next";
import { MfaForm } from "./mfa-form";

export const metadata: Metadata = { title: "Two-step verification" };

export default function MfaPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Two-step verification</h1>
        <p className="text-sm text-muted">Enter the 6-digit code from your authenticator app.</p>
      </div>
      <MfaForm />
    </main>
  );
}
