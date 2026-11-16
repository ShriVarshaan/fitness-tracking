"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { status: "idle" | "error" | "info"; message?: string };

const credentials = z.object({
  email: z.email({ error: "Enter a valid email address." }),
  password: z.string().min(8, { error: "Use at least 8 characters for the password." }).max(72),
});

function parse(formData: FormData) {
  return credentials.safeParse({ email: formData.get("email"), password: formData.get("password") });
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = parse(formData);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  // One message for wrong email or wrong password, so the form doesn't reveal which accounts exist.
  if (error) return { status: "error", message: "Email or password is incorrect." };

  // The proxy sends accounts with two-step verification on to /mfa.
  redirect("/");
}

export async function signUp(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const parsed = parse(formData);
  if (!parsed.success) return { status: "error", message: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp(parsed.data);
  if (error) {
    return { status: "error", message: error.code === "weak_password" ? error.message : "Couldn't create the account. Try again." };
  }

  // With email confirmation on, Supabase returns no session until the link is clicked.
  if (!data.session) {
    return { status: "info", message: "Check your email to confirm your account, then sign in." };
  }
  redirect("/");
}
