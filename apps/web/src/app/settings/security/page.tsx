import type { Metadata } from "next";
import Link from "next/link";
import { TwoStepSettings } from "./two-step-settings";

export const metadata: Metadata = { title: "Security" };

export default function SecurityPage() {
  return (
    <main className="mx-auto w-full max-w-xl flex-1 space-y-6 px-4 py-10">
      <Link href="/" className="text-sm text-muted underline">
        ← Today
      </Link>
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Two-step verification</h1>
        <p className="text-sm text-muted">
          Optional. When it&rsquo;s on, signing in also needs a 6-digit code from an authenticator app on your phone.
          Recommended if you connect your Garmin account.
        </p>
      </div>
      <TwoStepSettings />
    </main>
  );
}
