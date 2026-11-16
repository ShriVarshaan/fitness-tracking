"use client";

import { useActionState, useState } from "react";
import { signIn, signUp, type AuthState } from "./actions";

const initial: AuthState = { status: "idle" };

export function LoginForm() {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [signInState, signInAction, signingIn] = useActionState(signIn, initial);
  const [signUpState, signUpAction, signingUp] = useActionState(signUp, initial);

  const isSignUp = mode === "sign-up";
  const state = isSignUp ? signUpState : signInState;
  const pending = isSignUp ? signingUp : signingIn;

  return (
    <div className="space-y-4">
      <form action={isSignUp ? signUpAction : signInAction} className="space-y-3">
        <label htmlFor="email" className="block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        <label htmlFor="password" className="block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={isSignUp ? "new-password" : "current-password"}
          minLength={8}
          maxLength={72}
          required
          className="w-full rounded-md border border-border bg-surface px-3 py-2 outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {isSignUp && <p className="text-xs text-muted">At least 8 characters.</p>}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-accent px-3 py-2 font-medium text-accent-fg disabled:opacity-60"
        >
          {pending ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
        </button>
        <p
          role="status"
          aria-live="polite"
          className={`min-h-5 text-sm ${state.status === "error" ? "text-danger" : "text-muted"}`}
        >
          {state.message}
        </p>
      </form>
      <p className="text-sm text-muted">
        {isSignUp ? "Already have an account?" : "New here?"}{" "}
        <button type="button" className="font-medium text-foreground underline" onClick={() => setMode(isSignUp ? "sign-in" : "sign-up")}>
          {isSignUp ? "Sign in" : "Create an account"}
        </button>
      </p>
    </div>
  );
}
