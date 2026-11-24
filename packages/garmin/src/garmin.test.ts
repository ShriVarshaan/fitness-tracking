import { describe, expect, it, vi } from "vitest";
import { GarminClient } from "./client";
import { GarminAuthError, GarminHttpError, GarminRateLimitError } from "./errors";
import { chunkRange, fetchJob, planBackfill, planIncremental } from "./plan";
import { exchangeKey, jwtExpiry, needsRenewal, TOKEN_PATH } from "./token";

function fakeJwt(exp: number): string {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "RS256" })}.${enc({ sub: "x", exp })}.sig`;
}

const respond = (body: ConstructorParameters<typeof Response>[0], status = 200, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers });

describe("exchangeKey", () => {
  it("posts the key with the ApiKey scheme and reads the plain-text JWT", async () => {
    const exp = 1_800_000_000;
    const fetchImpl = vi.fn(async () => respond(`${fakeJwt(exp)}\n`));
    const token = await exchangeKey("  my-key ", fetchImpl);

    expect(token.expiresAt.getTime()).toBe(exp * 1000);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://personal.connectapi.garmin.com${TOKEN_PATH}`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("ApiKey my-key");
  });

  it("maps 401 to GarminAuthError", async () => {
    await expect(exchangeKey("bad", async () => respond("nope", 401))).rejects.toBeInstanceOf(GarminAuthError);
  });

  it("maps 429 to GarminRateLimitError with Retry-After", async () => {
    const err = await exchangeKey("k", async () => respond("", 429, { "retry-after": "120" })).catch((e) => e);
    expect(err).toBeInstanceOf(GarminRateLimitError);
    expect(err.retryAfterSeconds).toBe(120);
  });

  it("rejects an empty key without calling Garmin", async () => {
    const fetchImpl = vi.fn();
    await expect(exchangeKey("   ", fetchImpl)).rejects.toBeInstanceOf(GarminAuthError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("jwtExpiry / needsRenewal", () => {
  it("reads exp", () => {
    expect(jwtExpiry(fakeJwt(100)).getTime()).toBe(100_000);
  });

  it("renews inside the 1-hour window", () => {
    const now = new Date("2026-11-16T12:00:00Z");
    expect(needsRenewal(new Date("2026-11-16T12:59:00Z"), now)).toBe(true);
    expect(needsRenewal(new Date("2026-11-16T13:01:00Z"), now)).toBe(false);
    expect(needsRenewal(null, now)).toBe(true);
  });
});

describe("GarminClient", () => {
  it("sends the bearer token and query params", async () => {
    const fetchImpl = vi.fn(async () => respond(JSON.stringify({ data: [] })));
    const client = new GarminClient("tok", fetchImpl);
    await client.dailySummaries("2026-11-01", "2026-11-16");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://personal.connectapi.garmin.com/usersummary-service/v2/dailysummaries?startDate=2026-11-01&endDate=2026-11-16",
    );
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("returns null for an empty body", async () => {
    const client = new GarminClient("tok", async () => respond(""));
    expect(await client.hrvDay("2026-11-16")).toBeNull();
  });

  it("does not leak the response body in errors", async () => {
    const client = new GarminClient("tok", async () => respond("secret health data", 500));
    const err = (await client.profileSettings().catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(GarminHttpError);
    expect(String(err.message)).not.toContain("secret");
  });

  it("refuses non-numeric activity ids", () => {
    expect(() => new GarminClient("t").activity("../x")).toThrow(/positive integer/);
  });
});

describe("chunkRange", () => {
  it("splits newest first and clips the oldest chunk", () => {
    expect(chunkRange("2026-01-01", "2026-01-10", 4)).toEqual([
      { from: "2026-01-07", to: "2026-01-10" },
      { from: "2026-01-03", to: "2026-01-06" },
      { from: "2026-01-01", to: "2026-01-02" },
    ]);
  });

  it("returns nothing for an empty range", () => {
    expect(chunkRange("2026-01-02", "2026-01-01", 4)).toEqual([]);
  });
});

describe("planBackfill", () => {
  it("covers the whole history for every type with no gaps or overlaps", () => {
    const jobs = planBackfill("2026-11-16", 365);
    const sleep = jobs.filter((j) => j.dataType === "sleep");
    const days = sleep.reduce((n, j) => n + (Date.parse(j.to) - Date.parse(j.from)) / 86_400_000 + 1, 0);
    expect(days).toBe(365);
    expect(sleep[0]).toMatchObject({ to: "2026-11-16" });
    expect(sleep.at(-1)).toMatchObject({ from: "2025-11-17" });
  });

  it("puts every type's newest chunk first", () => {
    const jobs = planBackfill("2026-11-16", 365);
    const firstRound = new Set(jobs.slice(0, 7).map((j) => j.dataType));
    expect(firstRound.size).toBe(7);
  });

  it("loads only 28 nights of sleep stages (one call per night)", () => {
    const levels = planBackfill("2026-11-16", 365).filter((j) => j.dataType === "sleep_levels");
    expect(levels).toHaveLength(4);
    expect(levels.at(-1)).toMatchObject({ from: "2026-10-20" });
  });
});

describe("planIncremental", () => {
  it("re-fetches from two days before the last sync", () => {
    const jobs = planIncremental("2026-11-16", { sleep: "2026-11-15" });
    expect(jobs.find((j) => j.dataType === "sleep")).toEqual({
      kind: "incremental",
      dataType: "sleep",
      from: "2026-11-13",
      to: "2026-11-16",
    });
  });

  it("loads a short-history type's whole window the first time, then overlaps by one day", () => {
    const first = planIncremental("2026-11-16", {}).filter((j) => j.dataType === "sleep_levels");
    expect(first.at(-1)?.from).toBe("2026-10-20"); // 28 days
    const next = planIncremental("2026-11-16", { sleep_levels: "2026-11-16" }).filter((j) => j.dataType === "sleep_levels");
    expect(next).toEqual([{ kind: "incremental", dataType: "sleep_levels", from: "2026-11-15", to: "2026-11-16" }]);
  });

  it("never reaches further back than the history window", () => {
    const jobs = planIncremental("2026-11-16", { hrv: "2020-01-01" }, 30);
    const hrv = jobs.filter((j) => j.dataType === "hrv");
    expect(hrv.at(-1)?.from).toBe("2026-10-18");
  });
});

describe("fetchJob", () => {
  it("calls the single-night sleep endpoint once per date", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => respond(JSON.stringify({ dailySleepDTO: {} })));
    const out = await fetchJob(new GarminClient("t", fetchImpl), { dataType: "sleep_levels", from: "2026-11-14", to: "2026-11-16" });
    expect(out.map((o) => o.endpoint)).toEqual(["sleep_day", "sleep_day", "sleep_day"]);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("date=2026-11-14");
  });

  it("pages through activities until a short page", async () => {
    const page = (n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ activityId: i + 1 })));
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(respond(page(100)))
      .mockResolvedValueOnce(respond(page(3)));
    const out = await fetchJob(new GarminClient("t", fetchImpl), { dataType: "activities", from: "2026-11-01", to: "2026-11-16" });
    expect(out).toHaveLength(2);
    expect(String(fetchImpl.mock.calls[1]?.[0])).toContain("start=100");
  });
});
