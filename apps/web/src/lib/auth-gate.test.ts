import { describe, expect, it } from "vitest";
import { gate, isPublicPath, type Session } from "./auth-gate";

const allowed = (e: string | null) => e === "me@example.com";
const me2: Session = { email: "me@example.com", aal: "aal2" };
const me1: Session = { email: "me@example.com", aal: "aal1" };
const stranger: Session = { email: "someone@example.com", aal: "aal2" };

describe("isPublicPath", () => {
  it("matches public routes exactly or as prefixes", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/auth/callback")).toBe(true);
    expect(isPublicPath("/api/sync/tick")).toBe(true);
  });

  it("does not match look-alike paths", () => {
    expect(isPublicPath("/loginx")).toBe(false);
    expect(isPublicPath("/api/sync/tickle")).toBe(false);
    expect(isPublicPath("/")).toBe(false);
  });
});

describe("gate", () => {
  it("sends anonymous visitors to /login", () => {
    expect(gate("/", null, allowed)).toEqual({ action: "redirect", to: "/login" });
  });

  it("denies anonymous API calls instead of redirecting", () => {
    expect(gate("/api/garmin/key", null, allowed)).toEqual({ action: "deny" });
  });

  it("refuses a logged-in user who isn't the allowed email", () => {
    expect(gate("/", stranger, allowed)).toEqual({ action: "redirect", to: "/login" });
    expect(gate("/api/garmin/key", stranger, allowed)).toEqual({ action: "deny" });
  });

  it("requires the second factor before anything else", () => {
    expect(gate("/", me1, allowed)).toEqual({ action: "redirect", to: "/mfa" });
    expect(gate("/mfa", me1, allowed)).toEqual({ action: "next" });
    expect(gate("/api/garmin/key", me1, allowed)).toEqual({ action: "deny" });
  });

  it("lets the fully authenticated owner through", () => {
    expect(gate("/", me2, allowed)).toEqual({ action: "next" });
    expect(gate("/settings", me2, allowed)).toEqual({ action: "next" });
  });

  it("bounces the owner away from /login", () => {
    expect(gate("/login", me2, allowed)).toEqual({ action: "redirect", to: "/" });
  });

  it("always lets the cron endpoint through (it checks its own secret)", () => {
    expect(gate("/api/sync/tick", null, allowed)).toEqual({ action: "next" });
  });
});
