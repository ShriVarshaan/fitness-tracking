import { z } from "zod";

/** Values that are safe in the browser bundle. */
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

export function publicEnv() {
  return publicSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}

/** The only email address allowed to use the app (lower-cased). */
export function allowedEmail(): string {
  const value = process.env.ALLOWED_EMAIL?.trim().toLowerCase();
  if (!value) throw new Error("ALLOWED_EMAIL is not set");
  return value;
}

export function isAllowedEmail(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase() === allowedEmail();
}
