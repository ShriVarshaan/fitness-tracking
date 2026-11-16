import { addDays, daysBetween, type LocalDate } from "@ft/core";
import type { GarminClient } from "./client";

/**
 * What we pull and in what range sizes. Garmin documents no maximum range, so
 * chunks are conservative; tune once real limits are known (ADR).
 */
export const DATA_TYPES = {
  daily_summaries: { chunkDays: 28 },
  sleep: { chunkDays: 28 },
  hrv: { chunkDays: 28 },
  vo2max: { chunkDays: 28 },
  weight: { chunkDays: 90 },
  activities: { chunkDays: 30 },
} as const satisfies Record<string, { chunkDays: number }>;

export type DataType = keyof typeof DATA_TYPES;
export const ALL_DATA_TYPES = Object.keys(DATA_TYPES) as DataType[];

export interface PlannedJob {
  kind: "backfill" | "incremental";
  dataType: DataType;
  from: LocalDate; // inclusive
  to: LocalDate; // inclusive
}

/** Days of history to load when a key is first added. */
export const DEFAULT_HISTORY_DAYS = 365;
/** Re-fetch this many recent days on every incremental run (Garmin revises recent data). */
export const INCREMENTAL_OVERLAP_DAYS = 2;

/** Split [from, to] into chunks of `size` days, newest chunk first. */
export function chunkRange(from: LocalDate, to: LocalDate, size: number): Array<{ from: LocalDate; to: LocalDate }> {
  if (size < 1) throw new RangeError("chunk size must be ≥ 1");
  if (daysBetween(from, to) < 0) return [];
  const out: Array<{ from: LocalDate; to: LocalDate }> = [];
  let end = to;
  while (daysBetween(from, end) >= 0) {
    const startCandidate = addDays(end, -(size - 1));
    const start = daysBetween(from, startCandidate) < 0 ? from : startCandidate;
    out.push({ from: start, to: end });
    end = addDays(start, -1);
  }
  return out;
}

/** Jobs to load history for every data type, newest first so recent days appear soonest. */
export function planBackfill(today: LocalDate, historyDays = DEFAULT_HISTORY_DAYS): PlannedJob[] {
  const from = addDays(today, -(historyDays - 1));
  const perType = ALL_DATA_TYPES.map((dataType) =>
    chunkRange(from, today, DATA_TYPES[dataType].chunkDays).map((r) => ({ kind: "backfill" as const, dataType, ...r })),
  );
  // Interleave by chunk index: every type's newest chunk, then every type's next chunk, ...
  const out: PlannedJob[] = [];
  const longest = Math.max(...perType.map((l) => l.length));
  for (let i = 0; i < longest; i++) {
    for (const list of perType) {
      const job = list[i];
      if (job) out.push(job);
    }
  }
  return out;
}

/** Jobs to catch up each data type from its last sync (minus the overlap) to today. */
export function planIncremental(
  today: LocalDate,
  lastSynced: Partial<Record<DataType, LocalDate>>,
  historyDays = DEFAULT_HISTORY_DAYS,
): PlannedJob[] {
  const floor = addDays(today, -(historyDays - 1));
  return ALL_DATA_TYPES.flatMap((dataType) => {
    const last = lastSynced[dataType];
    let from = last ? addDays(last, -INCREMENTAL_OVERLAP_DAYS) : addDays(today, -INCREMENTAL_OVERLAP_DAYS);
    if (daysBetween(floor, from) < 0) from = floor;
    return chunkRange(from, today, DATA_TYPES[dataType].chunkDays).map((r) => ({ kind: "incremental" as const, dataType, ...r }));
  });
}

export interface FetchedPayload {
  endpoint: string;
  payload: unknown;
}

const ACTIVITY_PAGE_SIZE = 100;
const MAX_ACTIVITY_PAGES = 20;

/** Run one job's Garmin calls and return the raw responses to store. */
export async function fetchJob(client: GarminClient, job: Pick<PlannedJob, "dataType" | "from" | "to">): Promise<FetchedPayload[]> {
  const { from, to } = job;
  switch (job.dataType) {
    case "daily_summaries":
      return [{ endpoint: "dailysummaries", payload: await client.dailySummaries(from, to) }];
    case "sleep":
      return [{ endpoint: "sleep_summaries", payload: await client.sleepSummaries(from, to) }];
    case "hrv":
      return [{ endpoint: "hrv_daily", payload: await client.hrvSummaries(from, to) }];
    case "vo2max":
      return [{ endpoint: "vo2max_daily", payload: await client.vo2maxDaily(from, to) }];
    case "weight":
      return [{ endpoint: "weight_range", payload: await client.weightRange(from, to) }];
    case "activities": {
      const pages: FetchedPayload[] = [];
      for (let page = 0; page < MAX_ACTIVITY_PAGES; page++) {
        const payload = await client.searchActivities({
          start: page * ACTIVITY_PAGE_SIZE,
          limit: ACTIVITY_PAGE_SIZE,
          startDate: from,
          endDate: to,
        });
        pages.push({ endpoint: "activities_search", payload });
        if (!Array.isArray(payload) || payload.length < ACTIVITY_PAGE_SIZE) break;
      }
      return pages;
    }
  }
}
