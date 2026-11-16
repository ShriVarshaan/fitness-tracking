import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Fitness</h1>
        <p className="text-sm text-muted">Training and recovery from your Garmin data.</p>
      </div>
      <LoginForm />
    </main>
  );
}
