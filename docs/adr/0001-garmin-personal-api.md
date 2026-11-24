# ADR 0001: Garmin Personal API — what we confirmed

- **Status:** accepted
- **Date:** 2026-11-16
- **Answers:** the five Personal API questions in `docs/PLAN.md` §1

## Context

Garmin publishes token instructions and an FAQ for the Personal API, but no endpoint list, response schemas, range limits or rate limits. The endpoint paths below come from Garmin's official Python client (`github.com/garmin/connect-personal-api-python`, `src/garmin_personal_api/client.py`). Everything else was observed against a real account during the first sync (365 days of history).

## Findings

1. **Token.** `POST https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token` with `Authorization: ApiKey <key>` returns the access token as the **plain-text body**: a JWT with an `exp` claim, valid 24 hours or until the key expires. There is no refresh token. Garmin's client renews when less than 1 hour remains, and so do we.
2. **Endpoints used.** All are on the same host, with `Authorization: Bearer <token>`:

   | Data | Path |
   |---|---|
   | Daily summaries | `/usersummary-service/v2/dailysummaries` (`startDate`, `endDate`) |
   | Sleep | `/sleep-service/sleep/dailySleepSummariesByDate` (`startDate`, `endDate`) |
   | HRV | `/hrv-service/hrv/daily/{start}/{end}` |
   | VO2 max | `/metrics-service/metrics/maxmet/daily/{start}/{end}` |
   | Weight | `/weight-service/weight/range/{start}/{end}` |
   | Activities | `/activitylist-service/activities/search/activities` (`start`, `limit`, `startDate`, `endDate`) |
   | Original activity file | `/download-service/files/activity/{id}` (ZIP with the FIT file) |

   Daily summaries already include stress, Body Battery, resting HR, pulse ox, respiration, calories and intensity minutes. So we **don't call** the separate stress or Body Battery endpoints.
3. **Ranges.** 28-day chunks for daily data and 30-day chunks for activity search (100 per page) all succeeded. A full year of history loaded in about 74 calls, with no `429` responses seen. The real maximum range and rate limit are still unknown; chunk sizes are in `packages/garmin/src/plan.ts`.
4. **History.** At least 365 days are available. Deeper history hasn't been tested.
5. **FIT files.** The download endpoint exists. FIT decoding (laps, streams, strength sets) isn't built yet.
6. **Response quirks:**
   - "Local" timestamps are wall-clock times written as if they were UTC. Local minus GMT gives the event's UTC offset; we date every record by its own offset, which matters for travel.
   - Negative numbers (e.g. `-1`, `-2`) mean "no reading" and are stored as null.
   - Days without sleep come back as placeholder objects with `id` and `calendarDate` set to null.
   - Activity search returns the owner's name and profile image URLs. We drop these, along with exact start and end coordinates.
7. **Terms.** The Personal API is meant for "individual Garmin users who want programmatic access to their own data" and is "not intended for commercial applications serving multiple end users". This app lets each user paste their own key, for their own data, without charging anyone. The project owner accepted that grey area (see `docs/PLAN.md` §12).

## Consequences

- Mappers (`packages/garmin/src/mappers.ts`) are written against the observed shapes and are tolerant. A response that fails validation is quarantined: kept raw with an error set, not dropped.
- Weight (Nov 2026): the account still has no weight data, so the mapper follows Garmin Connect's web shape (`dailyWeightSummaries[].allWeightMetrics[]`, weight in grams). A weight outside 20–400 kg after conversion quarantines the response instead of storing it wrong. Garmin weights are stored in `body_measurements` with source `garmin`; on a day with both, the weight entered in the app wins.
