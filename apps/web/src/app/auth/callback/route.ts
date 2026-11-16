import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing page for links Supabase emails (e.g. confirming an account) and for
 * any OAuth sign-in added later: swap the one-time code for a session.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/login", request.url));

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  return NextResponse.redirect(new URL(error ? "/login" : "/", request.url));
}
