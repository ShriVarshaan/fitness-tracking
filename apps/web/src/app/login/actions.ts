"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { isAllowedEmail } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { status: "idle" | "sent" | "error"; message?: string };

const schema = z.object({ email: z.email() });

export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { status: "error", message: "Enter a valid email address." };

  // Same reply whether or not the address is allowed, so the page doesn't
  // reveal which email owns the app. Only the owner actually gets an email.
  const sent: LoginState = { status: "sent", message: "If that address can sign in, a link is on its way." };
  if (!isAllowedEmail(parsed.data.email)) return sent;

  const h = await headers();
  const origin = h.get("origin") ?? `https://${h.get("host")}`;
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) return { status: "error", message: "Couldn't send the link. Try again in a minute." };
  return sent;
}
