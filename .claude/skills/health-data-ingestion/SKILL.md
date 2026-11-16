---
name: health-data-ingestion
description: Use when adding or changing the Garmin Personal API client, token handling, sync jobs (/api/sync/tick, backfill, incremental), FIT decoding, a future importer (Garmin account export, Apple Health), or any code that writes health records into the canonical tables. Covers raw landing, validation, normalisation, units, time zones, provenance and idempotency.
---

# Health data ingestion

Design: `docs/PLAN.md` §1, §3–§5. This is the checklist every sync path must satisfy.

## Pipeline (never skip a stage)

1. **Token:** reuse the stored access token if > 10 min remain; otherwise POST the key (`Authorization: ApiKey <key>`) to the Personal API token endpoint. `401` → connection `key_invalid`, stop syncing. Never log either value.
2. **Jobs, not long requests.** `/api/sync/tick` plans jobs into `sync_jobs` (incremental: `last_synced_at − 2 days` → now; backfill: one job per type per range chunk, newest first), then claims jobs with `FOR UPDATE SKIP LOCKED` and stops after ~40 s. Retries use `attempts` + `run_after` with backoff; `429` backs off.
3. **Land raw:** insert the response into `raw_ingest` (endpoint, range, payload, sha256) before mapping.
4. **Validate** with the Zod schema for that endpoint. Failure → set `raw_ingest.error`, keep the payload (quarantine), surface it in Settings. Never drop data silently.
5. **Normalise + upsert** canonical rows in one transaction via mappers in `packages/garmin/mappers.ts`. Upsert on natural keys; never plain INSERT.
6. **Recompute** derived metrics from the earliest affected `local_date` forward, then rules, then due insights.

## Every canonical row must have

- `user_id` (the owner's auth id, from the connection row — never from the payload)
- Provenance: `source`, `source_record_id`, `source_device`, `fidelity` (`measured|device_estimated|manual|derived`), `raw_ingest_id`, `ingested_at`
- Canonical units via `packages/core/units.ts` (m, s, m/s, kg, kcal, bpm, ms, °C, % as 0–100, W, mL, g)
- Time: `timestamptz` instant + `tz_offset_min` **from the event itself** (Garmin `startTimeOffsetInSeconds`); `local_date` from that offset, not the current zone. Sleep belongs to the local date of waking. Daily summaries use Garmin's calendar date.

## Idempotency

- Garmin `summaryId` / `activityId` as `source_record_id`; dailies are revised during the day → upsert, keep latest.
- Re-running any job (same range) must produce zero new rows — test it.
- A future Garmin account-export importer must collide on the same keys, not duplicate.
- `hrv_rmssd_ms` and `hrv_sdnn_ms` are different metrics; never map one to the other.

## Storage budget (Supabase Free, 500 MB)

- Activity streams stored as `real[]` per stream, downsampled to 1 Hz. Original FIT files go to Supabase Storage, not the database.

## Definition of done for an endpoint

- Zod schema + fixture in `packages/test-fixtures/garmin/` + contract test.
- MSW-mocked integration test: tick → rows; replay → no new rows.
- DST-transition and travel fixtures pass for `local_date`.
- Sync status/errors visible in Settings.
