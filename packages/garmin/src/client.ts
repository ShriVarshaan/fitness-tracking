import { GarminAuthError, GarminHttpError, GarminRateLimitError } from "./errors";
import { GARMIN_BASE_URL, retryAfterSeconds, type FetchLike } from "./token";

/**
 * Typed paths for the Garmin Personal API, taken from Garmin's official client
 * (github.com/garmin/connect-personal-api-python, src/garmin_personal_api/client.py).
 * Garmin publishes no response schemas, so responses are returned as `unknown`
 * and validated by the mappers.
 */
export type IsoDate = string; // YYYY-MM-DD

export class GarminClient {
  constructor(
    private readonly accessToken: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  // --- daily, date-range endpoints -------------------------------------------------
  dailySummaries(start: IsoDate, end: IsoDate) {
    return this.get("/usersummary-service/v2/dailysummaries", { startDate: start, endDate: end });
  }
  sleepSummaries(start: IsoDate, end: IsoDate) {
    return this.get("/sleep-service/sleep/dailySleepSummariesByDate", { startDate: start, endDate: end });
  }
  hrvSummaries(start: IsoDate, end: IsoDate) {
    return this.get(`/hrv-service/hrv/daily/${start}/${end}`);
  }
  stressDaily(start: IsoDate, end: IsoDate) {
    return this.get(`/usersummary-service/stats/stress/daily/${start}/${end}`);
  }
  bodyBatteryDaily(start: IsoDate, end: IsoDate) {
    return this.get("/wellness-service/wellness/bodyBattery/reports/daily", { startDate: start, endDate: end });
  }
  vo2maxDaily(start: IsoDate, end: IsoDate) {
    return this.get(`/metrics-service/metrics/maxmet/daily/${start}/${end}`);
  }
  weightRange(start: IsoDate, end: IsoDate) {
    return this.get(`/weight-service/weight/range/${start}/${end}`, { includeAll: "true" });
  }

  // --- single-day endpoints ----------------------------------------------------------
  sleepDay(date: IsoDate) {
    return this.get("/sleep-service/sleep/dailySleep", { date });
  }
  hrvDay(date: IsoDate) {
    return this.get(`/hrv-service/hrv/${date}`);
  }
  heartRateDay(date: IsoDate) {
    return this.get("/wellness-service/wellness/dailyHeartRate", { date });
  }
  fitnessAge(date: IsoDate) {
    return this.get(`/fitnessage-service/fitnessage/v2/${date}`);
  }

  // --- profile -----------------------------------------------------------------------
  profileSettings() {
    return this.get("/userprofile-service/userprofile/settings");
  }
  heartRateZones() {
    return this.get("/biometric-service/heartRateZones/v2");
  }

  // --- activities --------------------------------------------------------------------
  searchActivities(opts: { start?: number; limit?: number; startDate?: IsoDate; endDate?: IsoDate }) {
    const params: Record<string, string> = {
      start: String(opts.start ?? 0),
      limit: String(opts.limit ?? 20),
    };
    if (opts.startDate) params.startDate = opts.startDate;
    if (opts.endDate) params.endDate = opts.endDate;
    return this.get("/activitylist-service/activities/search/activities", params);
  }
  activity(id: number | string) {
    return this.get(`/activity-service/activity/${assertActivityId(id)}`);
  }
  /** Original upload as ZIP bytes (contains the FIT file). */
  async downloadActivity(id: number | string): Promise<Uint8Array> {
    // Garmin returns 406 unless application/x-zip-compressed is acceptable (as in its own client).
    const res = await this.request(
      `/download-service/files/activity/${assertActivityId(id)}`,
      undefined,
      "application/zip, application/x-zip-compressed, application/octet-stream",
    );
    return new Uint8Array(await res.arrayBuffer());
  }

  // --- plumbing ----------------------------------------------------------------------
  async get(path: string, params?: Record<string, string>): Promise<unknown> {
    const res = await this.request(path, params, "application/json");
    const text = await res.text();
    return text ? (JSON.parse(text) as unknown) : null;
  }

  private async request(path: string, params: Record<string, string> | undefined, accept: string): Promise<Response> {
    const url = new URL(path, GARMIN_BASE_URL);
    for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);

    const res = await this.fetchImpl(url.toString(), {
      headers: { Accept: accept, Authorization: `Bearer ${this.accessToken}` },
      signal: AbortSignal.timeout(30_000),
    });

    if (res.status === 401 || res.status === 403) throw new GarminAuthError(res.status);
    if (res.status === 429) throw new GarminRateLimitError(retryAfterSeconds(res));
    if (!res.ok) throw new GarminHttpError(res.status, path);
    return res;
  }
}

function assertActivityId(id: number | string): string {
  const s = String(id);
  if (!/^[1-9]\d*$/.test(s)) throw new Error("activity id must be a positive integer");
  return s;
}
