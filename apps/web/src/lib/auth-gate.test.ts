import { describe, expect, it } from "vitest";
import { gate, isPublicPath, type Session } from "./auth-gate";

const noMfa: Session = { currentLevel: "aal1", nextLevel: "aal1" };
const mfaPending: Session = { currentLevel: "aal1", nextLevel: "aal2" };
const mfaDone: Session = { currentLevel: "aal2", nextLevel: "aal2" };

describe("isPublicPath", () => {
  it("matches public routes exactly or as prefixes", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/auth/callback")).toBe(true);
    expect(isPublicPath("/api/sync/tick")).toBe(true);
    expect(isPublicPath("/privacy")).toBe(true);
  });

  it("does not match look-alike paths", () => {
    expect(isPublicPath("/loginx")).toBe(false);
    expect(isPublicPath("/api/sync/tickle")).toBe(false);
    expect(isPublicPath("/")).toBe(false);
  });
});

describe("gate", () => {
  it("sends anonymous visitors to /login", () => {
    expect(gate("/", null)).toEqual({ action: "redirect", to: "/login" });
  });

  it("denies anonymous API calls instead of redirecting", () => {
    expect(gate("/api/garmin/key", null)).toEqual({ action: "deny" });
  });

  it("lets signed-in users without two-step verification through", () => {
    expect(gate("/", noMfa)).toEqual({ action: "next" });
    expect(gate("/api/garmin/key", noMfa)).toEqual({ action: "next" });
  });

  it("requires the second step once an account has turned it on", () => {
    expect(gate("/", mfaPending)).toEqual({ action: "redirect", to: "/mfa" });
    expect(gate("/mfa", mfaPending)).toEqual({ action: "next" });
    expect(gate("/api/garmin/key", mfaPending)).toEqual({ action: "deny" });
  });

  it("lets a user who completed the second step through", () => {
    expect(gate("/", mfaDone)).toEqual({ action: "next" });
  });

  it("sends users who don't need /mfa away from it", () => {
    expect(gate("/mfa", noMfa)).toEqual({ action: "redirect", to: "/" });
    expect(gate("/mfa", mfaDone)).toEqual({ action: "redirect", to: "/" });
  });

  it("bounces signed-in users away from /login, but not mid-verification", () => {
    expect(gate("/login", noMfa)).toEqual({ action: "redirect", to: "/" });
    expect(gate("/login", mfaPending)).toEqual({ action: "next" });
  });

  it("always lets the cron endpoint through (it checks its own secret)", () => {
    expect(gate("/api/sync/tick", null)).toEqual({ action: "next" });
  });
});
