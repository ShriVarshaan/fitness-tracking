# ADR 0003: Importing the Garmin account export and Apple Health

- **Status:** accepted
- **Date:** 2026-11-24

## Context

The Personal API loads about a year of history (ADR 0001). Older Garmin history only exists in the account export, and people without a Garmin watch may have years of data in Apple Health. Both exports are ZIP files that can run to gigabytes. Vercel functions accept request bodies of about 4.5 MB, and the free database is 500 MB.

## Decision

1. **Parse in the browser.** The Settings → Import page reads the ZIP on the person's device. A small ZIP reader (`apps/web/src/lib/import/zip.ts`, ZIP64 included) uses the File's random access and the platform `DecompressionStream`, so only the entries we need are inflated, and they are streamed. Apple's `export.xml` is parsed in chunks and only per-day aggregates, nights and workouts are kept. Mapped rows go to a server action in batches of 250.
2. **Validate twice.** Rows are checked in the browser against the canonical schemas (`lib/import/rows.ts`), so a bad row is counted rather than sent. The server parses every batch again with the same schemas and takes the user id from the session, never from the request.
3. **No raw landing for imports.** Unlike sync responses, the export files aren't stored in `raw_ingest`: they are large and stay on the person's device, and re-importing is idempotent. This is a deliberate exception to the ingestion checklist.
4. **Precedence: Garmin API > Garmin export > Apple Health**, so each day has one source per table and readers never add two together:
   - Garmin export rows are Garmin's data and use `source = 'garmin'`, colliding with the API on the same keys (activities by activity id, days by date). On conflict the API's row is kept. Export nights get ids `export-<date>`; when the API stores that night, the export copy is deleted.
   - Apple Health rows use `source = 'apple_health'` and fill only days, nights and VO2 max dates without a Garmin row, and workouts that don't start within 10 minutes of a Garmin activity. When Garmin data arrives later (sync or export), the Apple rows for those days or sessions are deleted (`server/imports.ts` → `supersedeApple`, called from `server/process.ts`).
   - Weights keep every source; readers keep one per day: entered in the app, then Garmin, then Apple.
5. **Units are checked, not assumed.** The Garmin export's activity units differ from the API's. Published exports use centimetres, milliseconds and cm/ms. The importer detects the scheme from the data: distance ÷ duration must agree with the average speed, and the size of the durations separates milliseconds from seconds. It refuses a file it can't place. Cadence and calories are left out because their units can't be checked this way (strides or steps, kJ or kcal). Zone times are read as seconds unless they add up to more than the activity, in which case they are milliseconds.
6. **Apple Health specifics.** Additive quantities (steps, distance, energy, flights) are summed per day *per source*, keeping the source with the largest total, because iPhone and Watch both record steps. Sleep samples are grouped per source into nights (a gap over 90 minutes starts a new night, and under 3 hours asleep is a nap and isn't stored). Each wake date keeps the source with the most sleep. HRV isn't imported: Apple reports SDNN, and this app's HRV is Garmin's RMSSD, which is a different metric (derived-metrics rules). SpO2 and respiration aren't imported either, because Apple's are spot checks rather than overnight averages.
7. **Storage.** Imported Garmin activities older than 365 days are marked as fetched, so the sync doesn't download thousands of activity files into the 500 MB database. Apple workouts have no activity file.

## Consequences

- The export mappers follow published samples; Garmin documents neither export. When a field is missing, the row keeps a null rather than a guess, and the import summary lists skipped records and unreadable files.
- Activity charts aren't available for imported activities older than a year, or for Apple workouts.
- Labels name the source where both can supply a value: resting HR, steps, sleep and VO2 max say Garmin or Apple Health as appropriate, and insight evidence says "measured".
