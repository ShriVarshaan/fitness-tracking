import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { gate, type Session } from "@/lib/auth-gate";
import { isAllowedEmail, publicEnv } from "@/lib/env";

/**
 * Runs before every page and API route:
 * 1. refreshes the Supabase session cookie;
 * 2. lets only the allowed email, with the second factor done, past.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const env = publicEnv();

  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  // getClaims() verifies the JWT; never trust an unverified session cookie.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const session: Session = claims
    ? {
        email: typeof claims.email === "string" ? claims.email : null,
        aal: claims.aal === "aal2" ? "aal2" : "aal1",
      }
    : null;

  const result = gate(request.nextUrl.pathname, session, isAllowedEmail);

  if (result.action === "deny") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (result.action === "redirect") {
    const redirect = NextResponse.redirect(new URL(result.to, request.url));
    // Keep any refreshed session cookies.
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets and image optimisation.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
