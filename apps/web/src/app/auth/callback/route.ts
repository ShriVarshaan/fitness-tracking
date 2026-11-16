import { NextResponse, type NextRequest } from "next/server";
import { isAllowedEmail } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/** Magic-link landing: swap the one-time code for a session, then go to MFA. */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const fail = NextResponse.redirect(new URL("/login?error=link", request.url));
  if (!code) return fail;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !isAllowedEmail(data.user?.email)) {
    await supabase.auth.signOut();
    return fail;
  }

  return NextResponse.redirect(new URL("/mfa", request.url));
}
