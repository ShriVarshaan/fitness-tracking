/**
 * Pure routing decision for the proxy, kept separate so it can be unit tested.
 *
 * - Public paths (login, auth callback, cron endpoint) always pass; the cron
 *   endpoint checks its own bearer secret.
 * - Everyone else must be logged in as the allowed email AND have completed
 *   the second factor (AAL2). Until then they can only reach /mfa.
 */
export type Session = { email: string | null; aal: "aal1" | "aal2" | null } | null;

export type GateResult =
  | { action: "next" }
  | { action: "redirect"; to: "/login" | "/mfa" | "/" }
  | { action: "deny" };

const PUBLIC_PREFIXES = ["/login", "/auth/", "/api/sync/tick"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`));
}

export function gate(pathname: string, session: Session, emailAllowed: (e: string | null) => boolean): GateResult {
  const isApi = pathname.startsWith("/api/");

  if (isPublicPath(pathname)) {
    // Logged-in users have no reason to see the login page.
    if (pathname === "/login" && session && emailAllowed(session.email) && session.aal === "aal2") {
      return { action: "redirect", to: "/" };
    }
    return { action: "next" };
  }

  if (!session || !emailAllowed(session.email)) {
    return isApi ? { action: "deny" } : { action: "redirect", to: "/login" };
  }

  if (session.aal !== "aal2") {
    if (pathname === "/mfa") return { action: "next" };
    return isApi ? { action: "deny" } : { action: "redirect", to: "/mfa" };
  }

  return { action: "next" };
}
