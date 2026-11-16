/** Garmin rejected the API key or access token (401/403). */
export class GarminAuthError extends Error {
  constructor(readonly status: number) {
    super(`Garmin rejected the credentials (HTTP ${status})`);
    this.name = "GarminAuthError";
  }
}

/** Too many requests; retry after `retryAfterSeconds`. */
export class GarminRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`Garmin rate limit hit; retry after ${retryAfterSeconds}s`);
    this.name = "GarminRateLimitError";
  }
}

/** Any other non-2xx response. The body is deliberately not included (it may contain health data). */
export class GarminHttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
  ) {
    super(`Garmin request failed: HTTP ${status} for ${path}`);
    this.name = "GarminHttpError";
  }
}
