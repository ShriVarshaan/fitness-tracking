import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage(props: PageProps<"/login">) {
  const { deleted } = (await props.searchParams) as { deleted?: string };
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center gap-6 px-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Fitness</h1>
        <p className="text-sm text-muted">Training and recovery from your Garmin data.</p>
      </div>
      {deleted === "1" && (
        <p role="status" className="rounded-md border border-border bg-surface p-3 text-sm">
          Your account and all of its data have been deleted.
        </p>
      )}
      <LoginForm />
      <p className="text-xs text-muted">
        <a href="/privacy" className="underline">
          Privacy notice
        </a>{" "}
        · General wellness information, not medical advice.
      </p>
    </main>
  );
}
