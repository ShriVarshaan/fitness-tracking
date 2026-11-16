import { GarminAuthError, GarminHttpError, GarminRateLimitError } from "./errors";

export const GARMIN_BASE_URL = "https://personal.connectapi.garmin.com";
export const TOKEN_PATH = "/personalapitoken-service/personal-api/personal-api-key/token";

/** Renew tokens this long before they expire (Garmin's own client uses 1 hour). */
export const TOKEN_REFRESH_WINDOW_MS = 60 * 60 * 1000;

export interface AccessToken {
  token: string;
  expiresAt: Date;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Read the `exp` claim of a JWT without verifying it (Garmin verifies it, we only schedule renewal). */
export function jwtExpiry(jwt: string): Date {
  const payload = jwt.split(".")[1];
  if (!payload) throw new Error("Garmin token is not a JWT");
  const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { exp?: unknown };
  if (typeof json.exp !== "number") throw new Error("Garmin token has no exp claim");
  return new Date(json.exp * 1000);
}

export function retryAfterSeconds(res: Response, fallback = 60): number {
  const value = Number(res.headers.get("retry-after"));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Swap a Personal API key for a 24-hour access token.
 * Garmin returns the token as the plain-text response body.
 */
export async function exchangeKey(apiKey: string, fetchImpl: FetchLike = fetch): Promise<AccessToken> {
  const key = apiKey.trim();
  if (!key) throw new GarminAuthError(400);

  const res = await fetchImpl(`${GARMIN_BASE_URL}${TOKEN_PATH}`, {
    method: "POST",
    headers: { Accept: "*/*", Authorization: `ApiKey ${key}` },
    signal: AbortSignal.timeout(20_000),
  });

  if (res.status === 400 || res.status === 401 || res.status === 403) throw new GarminAuthError(res.status);
  if (res.status === 429) throw new GarminRateLimitError(retryAfterSeconds(res));
  if (!res.ok) throw new GarminHttpError(res.status, TOKEN_PATH);

  const token = (await res.text()).trim();
  return { token, expiresAt: jwtExpiry(token) };
}

/** True if a stored token is missing or inside the renewal window. */
export function needsRenewal(expiresAt: Date | null | undefined, now: Date = new Date()): boolean {
  return !expiresAt || expiresAt.getTime() - now.getTime() <= TOKEN_REFRESH_WINDOW_MS;
}
