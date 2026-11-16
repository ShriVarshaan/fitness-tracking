/**
 * Pure routing decision for the proxy, kept separate so it can be unit tested.
 *
 * - Public paths (login, auth callback, cron endpoint) always pass; the cron
 *   endpoint checks its own bearer secret.
 * - Everyone else must be logged in.
 * - Two-step verification is optional, but once an account has turned it on
 *   (`nextLevel` is aal2) the second step is required before anything but /mfa.
 */
export type Aal = "aal1" | "aal2";
export type Session = { currentLevel: Aal; nextLevel: Aal } | null;

export type GateResult =
  | { action: "next" }
  | { action: "redirect"; to: "/login" | "/mfa" | "/" }
  | { action: "deny" };

const PUBLIC_PREFIXES = ["/login", "/auth/", "/api/sync/tick", "/privacy"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}/`));
}

function needsSecondStep(session: NonNullable<Session>): boolean {
  return session.nextLevel === "aal2" && session.currentLevel !== "aal2";
}

export function gate(pathname: string, session: Session): GateResult {
  const isApi = pathname.startsWith("/api/");

  if (isPublicPath(pathname)) {
    // Fully signed-in users have no reason to see the login page.
    if (pathname === "/login" && session && !needsSecondStep(session)) {
      return { action: "redirect", to: "/" };
    }
    return { action: "next" };
  }

  if (!session) {
    return isApi ? { action: "deny" } : { action: "redirect", to: "/login" };
  }

  if (needsSecondStep(session)) {
    if (pathname === "/mfa") return { action: "next" };
    return isApi ? { action: "deny" } : { action: "redirect", to: "/mfa" };
  }

  if (pathname === "/mfa") return { action: "redirect", to: "/" };
  return { action: "next" };
}
