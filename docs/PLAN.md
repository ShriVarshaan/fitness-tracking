# Personal Fitness Tracker — Plan

> Status: Phase 0 in progress. Rewritten 16 Nov 2026 for a £0 build; updated the same day to open sign-ups (each account sees only its own data).
> It replaces the earlier family / Garmin Starter / Oracle Cloud plan, which was never committed.

## Context

A web app built for me, with **open sign-up** so recruiters and others can create an account and try it. It:

- pulls each user's Garmin data using their own free Garmin **Personal API key**, pasted into a box in the app;
- shows dashboards and trends similar to Garmin Connect+ where a website can do that;
- gives **advice traceable to the numbers**, and says plainly when data is missing;
- costs **£0** to run.

**Decisions:**

| Topic | Decision | Consequence |
|---|---|---|
| Users | Me, plus **anyone who signs up** (e.g. recruiters) | Email + password sign-up with no confirmation email (Supabase's free email only reaches team members). Every account sees only its own rows (RLS). Two-step verification optional per account. No family sharing or admin pages. |
| Data source | **Garmin Personal API**, key pasted into Settings | Pull only. No approval process. Key → 24 h access token, no refresh token. Key lifetime 30 d / 90 d / 180 d / 1 yr, chosen when created; shown only once. |
| Hosting | **Vercel Hobby** (free, personal non-commercial use) | Next.js deploys from GitHub. Serverless functions only, no long-running worker. Vercel cron is limited to once a day on Hobby, so scheduling moves to Supabase. |
| Database, secrets, login, scheduling | **Supabase Free**, Frankfurt region (eu-central-1) | Postgres for all data, **Vault** for each user's Garmin key, **Auth** for accounts, **Cron** (pg_cron + pg_net) to trigger syncs. Vercel functions pinned to `fra1` to sit next to the database. |
| AI advice | **Groq free tier** (optional) → deterministic template fallback | No paid fallback. The app is fully useful with AI switched off. |
| Approximations | Build home-made scores, **clearly labelled** | Every estimate shows "Estimate · our formula", its formula and a confidence level. Nothing is presented as a Garmin metric. |

**Out of scope for now:** Apple Health, Google Health API, Garmin Starter (webhooks, pushing workouts and courses to the watch), native iOS app. The data model keeps a `source` column so another source can be added later.

---

## 1. Garmin Personal API

| Item | Detail |
|---|---|
| Who it's for | One person accessing their own data; "not for apps serving multiple end users". **Risk accepted:** each user pastes their own key for their own data, which is a grey area under these terms (see §12). |
| APIs | Activity (JSON summaries + FIT files), Health, Women's Health. |
| Auth | `POST https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token` with header `Authorization: ApiKey <key>` → bearer access token valid **24 h or until the key expires**, whichever is first. No refresh token: request a new token with the key. |
| Delivery | Pull only. Per-call date ranges (e.g. daily summaries up to 1 year per call), which also gives **history backfill** without the Garmin account export. |
| Cost | Free. |

**To confirm against Garmin's docs at the start of Phase 1** (record answers in `docs/adr/`):
1. The exact endpoint list and which summary types are available (dailies, sleep, HRV, stress / Body Battery, user metrics such as VO2 max and fitness age, pulse ox, respiration, body composition, activities, activity details, FIT files).
2. Maximum range per call per type, and how far back history goes.
3. Rate limits.
4. Whether FIT files are returned and which fields are stripped (Garmin strips some undocumented fields such as VO2 max and recovery time from FIT files given to third parties).
5. Terms that apply to a personal key: attribution, storing data, sending data to an AI provider (Groq).

**Fallback:** if the Personal API lacks something important (for example full history or FIT files), add an importer for the Garmin account data export ("Export Your Data" zip with `DI_CONNECT/…` FIT files and wellness JSON).

---

## 2. Architecture & stack

```
 Me (browser / installable PWA on iPhone)
        │ HTTPS
        ▼
┌───────────────────────── Vercel Hobby ─────────────────────────┐
│  Next.js (App Router)                                          │
│   • UI (server components read from Supabase)                  │
│   • /api/garmin/key      save / replace key  (server only)     │
│   • /api/sync/tick       called by Supabase Cron, CRON_SECRET  │
│   • /api/chat            optional AI chat (Phase 3)            │
└──────────────┬─────────────────────────────────┬───────────────┘
               │ service-role key (server only)  │ bearer token
               ▼                                 ▼
┌─────── Supabase Free · Frankfurt ──────┐   Garmin Personal API
│  Postgres: health data, sync_jobs      │
│  Vault: Garmin API key, access token,  │   Groq (optional, AI text)
│         CRON_SECRET                    │
│  Auth: email + password, open sign-up, │
│        optional TOTP MFA               │
│  Cron: every 30 min → pg_net POST      │
│        /api/sync/tick                  │
│  Storage: raw FIT files (1 GB free)    │
└────────────────────────────────────────┘
```

**One language: TypeScript.**

| Concern | Choice | Why |
|---|---|---|
| Repo | pnpm workspaces monorepo | Shared types between the app and packages. |
| Web + API | **Next.js (App Router)** on Vercel | Server components suit data-heavy dashboards; route handlers cover the key box, sync and chat. |
| Database | **Supabase Postgres** | Window functions for rolling averages and baselines, JSONB for raw payloads, row-level security. |
| DB access | **Drizzle ORM** + drizzle-kit migrations, via Supabase's transaction pooler (`prepare: false`) | Typed, SQL-first, easy raw SQL for analytics. `supabase-js` is used only for Auth. |
| Secrets | **Supabase Vault** | Garmin key encrypted at rest in the database; decrypted only through `SECURITY DEFINER` functions granted to `service_role`. |
| Login | **Supabase Auth**: email + password, open sign-up, "Confirm email" off; optional TOTP MFA enforced by `src/proxy.ts` once enabled | Free, no email service or domain needed. |
| Scheduling | **Supabase Cron** (pg_cron + pg_net) → `/api/sync/tick` | Every 30 min for free; Vercel Hobby cron is once a day. |
| Background work | `sync_jobs` table processed in small steps per tick | No long-running worker on Vercel. Each tick claims a few jobs (`FOR UPDATE SKIP LOCKED`) and stays well within the function time limit. |
| Validation | **Zod** | Garmin payloads, API inputs, LLM structured output. |
| FIT files | **@garmin/fitsdk** | Official decoder; reads laps, strength sets and RPE. |
| Time zones | date-fns v4 + `@date-fns/tz` | Correct DST arithmetic. |
| Charts | **Apache ECharts** (`echarts-for-react`) | Handles dense series; dual axes, zoom, calendar heatmaps. |
| Maps | **MapLibre GL JS** + OpenFreeMap tiles (+ free DEM tiles for 3D) | Open source, no paid key. |
| UI | Tailwind CSS + shadcn/ui; PWA so it installs on the iPhone home screen | Fast to build. |
| LLM | **Vercel AI SDK** with the Groq provider | Tool calling and Zod structured output; easy to swap providers. |
| Tests | **Vitest**, **MSW** (mock Garmin), Supabase CLI local stack (Docker) for RLS and SQL tests, **Playwright** for E2E | Real Postgres in tests. |

**Repository layout:**

```
apps/web/                Next.js app: app/(app)/…, app/login, app/api/garmin/key, app/api/sync/tick, app/api/chat
packages/db/             src/schema/*.ts (Drizzle), migrations, Vault helper SQL, RLS policies
packages/core/           metric registry, units.ts, time.ts (local-date attribution)
packages/garmin/         token.ts (key → access token), client.ts (typed endpoints), schemas.ts (Zod), mappers.ts, fit.ts
packages/sync/           job planner (backfill + incremental), job runner
packages/metrics/        load.ts, hrv.ts, rhr.ts, sleep.ts, readiness.ts, performance.ts, rules/*.ts
packages/advice/         evidence packet, prompts, validators, templates, chat tools
packages/test-fixtures/  garmin/*.json, fit/*.fit
supabase/                config.toml, migrations for Vault/cron/RLS (or generated from packages/db)
docs/                    PLAN.md, adr/*.md
```

---

## 3. Garmin key handling

1. **Settings → Garmin → "Paste your Personal API key".** The form posts to `/api/garmin/key` (server only; requires login).
2. The server **tests the key** by requesting an access token. If that fails, it shows the error and saves nothing.
3. On success it stores the key in **Vault** (`vault.create_secret` / `vault.update_secret`) along with the key's expiry date (I enter it, since the key's lifetime is chosen when it is created). The access token and its expiry are stored in Vault too.
4. The browser never receives the key or token back. Settings shows only: *key saved · expires in N days · last sync 10:30 · next sync 11:00*.
5. Before each sync, the server reuses the token if it has more than 10 minutes left; otherwise it requests a new one from the key.
6. **Expiry warnings** at 14, 7 and 1 days on the Today page. A `401` from the token endpoint marks the connection "key expired or revoked" and pauses syncing.
7. **Remove key** deletes the Vault secrets and stops syncing. A separate "Delete all my Garmin data" button purges the data.

Vault access goes through `SECURITY DEFINER` functions in a non-exposed `private` schema (`private.get_secret`, `private.set_secret`, `private.delete_secret`; secret names `garmin_api_key:<user_id>`, `garmin_access_token:<user_id>`) with `EXECUTE` granted only to `service_role`. The service-role key is a Vercel environment variable used only in server code and never prefixed `NEXT_PUBLIC_`.

---

## 4. Sync

**Tick** (`/api/sync/tick`, every 30 min from Supabase Cron, authenticated with `CRON_SECRET` from Vault):
1. If there's no valid key, stop.
2. Plan jobs:
   - **Incremental:** for each data type, fetch from `last_synced_at − 2 days` to now (Garmin revises recent days, so overlap and upsert).
   - **Backfill:** on first connection, queue one job per data type per range chunk going back as far as the API allows, newest first.
3. Run jobs until about 40 s have passed, then return. The remaining jobs run on the next tick. During backfill the Settings page can trigger extra ticks so history loads faster.
4. Each job: fetch → store raw JSON in `raw_ingest` → validate with Zod → upsert canonical rows (idempotent on Garmin IDs) → mark processed. Payloads that fail validation are **quarantined**: the raw data is kept and Settings shows an error.
5. After new data arrives: recompute derived metrics from the earliest affected date forward, then evaluate rules, then generate any due insight.

**Errors:** failed jobs retry with backoff (attempts and `run_after` columns). `429` responses back off. A gap check flags "no Garmin daily summary for yesterday".

**Keeping Supabase awake:** free projects pause after about a week of inactivity. The 30-minute sync should count as activity; confirm this in the first week, and if it doesn't, add a daily external ping.

---

## 5. Data model

All tables have `user_id` (my Supabase Auth ID), even with one user, so RLS can be a simple `auth.uid() = user_id` policy. RLS is enabled on every table; the server's sync code uses the service role.

**Provenance on source-derived rows:** `source` (`garmin` | `manual`; room for more later), `source_record_id`, `source_device`, `fidelity` (`measured` | `device_estimated` | `manual` | `derived`), `raw_ingest_id`, `ingested_at`.

**Units:** stored canonical (m, s, m/s, kg, kcal, bpm, ms, °C, % as 0–100, W, mL, g) and converted for display.

**Time:** instants are `timestamptz` (UTC) plus `tz_offset_min` from the event (Garmin `startTimeOffsetInSeconds`). `local_date` comes from the event's own offset, so a run abroad lands on the right day. Sleep is dated to the morning I wake up.

| Table | Contents |
|---|---|
| `profile` | display name, time zone, birth year, sex (optional, for formulas), height, units, sleep need, insight times |
| `user_physiology` | HR max, resting-HR baseline, LTHR, FTP, threshold pace, zone model (derived defaults, overridable) |
| `garmin_connection` | status, key expiry date, token expiry, last sync per data type, last error (secrets themselves live in Vault) |
| `sync_jobs` | type, range_from, range_to, status, attempts, run_after, error |
| `raw_ingest` | endpoint, range, payload JSONB, sha256, received_at, processed_at, error (kept 30 days) |
| `metric_definitions` | code, unit, kind, aggregation, description (registry; HRV RMSSD and SDNN never mixed) |
| `observations` | point and interval values: HR, resting HR, HRV, SpO2, respiration, stress, Body Battery, weight, body fat, VO2 max, fitness age, skin temperature |
| `daily_summaries` | steps, distance, active and BMR kcal, floors, intensity minutes, resting HR, stress, Body Battery, SpO2, respiration (one row per day, upserted) |
| `activities` | sport, times, duration, distance, ascent, HR, speed, power, cadence, kcal, Garmin training load and training effect, RPE, feel, route bbox |
| `activity_laps`, `activity_sets` | laps; strength sets (exercise, reps, weight) |
| `activity_streams` | one row per stream (time, HR, speed, power, cadence, altitude, lat, lon) as `real[]`, downsampled to 1 Hz, to stay within the 500 MB limit |
| `activity_bests` | mean-maximal power, pace and HR points |
| `sleep_sessions`, `sleep_stages` | totals, stages, Garmin sleep score, HRV, SpO2, respiration |
| `nutrition_entries` | manual entries and Open Food Facts lookups (Phase 3) |
| `derived_daily` | TRIMP, CTL, ATL, TSB, ACWR, HRV and RHR baselines, sleep debt, SRI, readiness; with `algo_version`, `inputs_hash`, `confidence` |
| `findings` | rule outputs with evidence and confidence |
| `insights` | morning / post-workout / evening / weekly text, model used, validator result |
| `goals`, `training_plans`, `planned_workouts`, `dashboards`, `chat_threads`, `chat_messages` | later phases |

**Storage budget (500 MB database):** daily summaries and sleep are tiny. Activity streams dominate: at 1 Hz a one-hour run is about 3,600 points × 8 streams ≈ 115 KB, so roughly 3,000 one-hour activities fit in about 350 MB. Original FIT files go to Supabase Storage (1 GB free) and can be pruned. Show database size on the Settings page.

---

## 6. Derived metrics

All in `packages/metrics`: pure functions with golden-value tests, `algo_version` and `confidence`. The UI labels them **"Estimate · our formula"** with a "how it's calculated" link. Garmin's own values (Body Battery, stress, sleep score, training effect, VO2 max, fitness age, HRV status) are shown **as Garmin's** when present and never relabelled.

| Metric | Formula / method | Reference |
|---|---|---|
| HR max | 99th-percentile activity HR over 12 months; otherwise Tanaka 208 − 0.7 × age (low confidence) | Tanaka, Monahan & Seals 2001, *JACC* 37:153–156 |
| HR zones | % of HR reserve (Karvonen) using the resting-HR baseline | Karvonen et al. 1957 |
| Session load (HR) | Banister TRIMP per sample (sex-specific weighting) once HR streams exist (FIT files). **v1 (summary data only):** Edwards summated-zone TRIMP = Σ minutes in zone × zone number (1–5), using Garmin's per-activity HR zone times (zones as configured in Garmin). Activities without HR zone data contribute no load and are listed as missing. | Banister 1991; Morton, Fitz-Clarke & Banister 1990; Edwards 1993 |
| Session load (no HR) | Session-RPE = CR-10 RPE × minutes | Foster et al. 2001, *JSCR* 15:109–115 |
| Cycling load with power | TSS = (s × NP × IF) / (FTP × 3600) × 100 | Allen & Coggan |
| Fitness / fatigue / form | CTL = EWMA(load, 42 d), ATL = EWMA(load, 7 d), TSB = CTL − ATL (previous day) | Banister impulse-response; Coggan PMC |
| Acute:chronic ratio | EWMA-ACWR (λa = 2/8, λc = 2/29); **descriptive "load spike" only, not an injury predictor** | Williams et al. 2017; caveats Impellizzeri et al. 2020 |
| Load focus | 4-week load split by HR zones 1–2 / 3–4 / 5, or Garmin training effect when present | Heuristic, labelled |
| HRV baseline | ln(overnight RMSSD); 7-day mean (≥ 3 nights) vs 60-day baseline mean ± 0.5 SD (sample SD; window includes the 7 days); z = (7-day mean − baseline) / SD (0 if SD = 0); needs ≥ 14 nights; confidence 0.5 at 14 nights rising linearly to 1 at 30 | Plews et al. 2012, 2013; Buchheit 2014 |
| Resting HR trend | 7-day mean (≥ 3 days) vs 60-day baseline mean and sample SD; needs ≥ 14 days (same confidence curve as HRV); elevated if > baseline + max(5 bpm, 2 SD) for ≥ 3 days | Buchheit 2014 |
| Sleep debt | Σ over the last 7 nights of max(0, need − actual sleep); need from the profile (default 8 h); nights with no record are skipped, not counted as zero; needs ≥ 3 nights; confidence = nights / 7 | Hirshkowitz et al. 2015; Watson et al. 2015 |
| Sleep consistency | Sleep Regularity Index, midpoint SD, social jetlag | Phillips et al. 2017; Wittmann et al. 2006 |
| **Readiness (estimate)** | 0–100 weighted mean of component scores; weights HRV 30%, resting HR 20%, sleep 20%, regularity 10%, load 20%, renormalised over available components (≥ 50% of weight required, else no score). Components: HRV = L(z of 7-day lnRMSSD); resting HR = L(−(today − baseline)/SD); sleep = clamp(100 × (actual/need − 0.5)/0.5, 0, 100); regularity = SRI (missing until sleep epochs exist); load = L(TSB/10), only when the load model's confidence ≥ 0.5. L(z) = 100 / (1 + e^(−1.5z)). Confidence = available weight × mean component confidence. | Composite heuristic informed by Plews 2013 and Buchheit 2014; **unvalidated, and says so** |
| Intensity minutes | Moderate + 2 × vigorous vs 150 min/week | WHO 2020 (Bull et al., *BJSM* 54:1451) |
| VO2 max if missing | Uth 15.3 × HRmax / HRrest (low confidence), or VDOT from race-like efforts | Uth et al. 2004; Daniels |
| Race predictor | Riegel T₂ = T₁ (D₂/D₁)^1.06, cross-checked with VDOT | Riegel 1981 |
| Critical speed / power | Distance–time fit of 2–4 maximal efforts (3–20 min) | Monod & Scherrer 1965; Jones et al. 2010 |
| Grade-adjusted pace | Minetti energy-cost polynomial | Minetti et al. 2002 |
| Energy and macro targets | Mifflin-St Jeor BMR + measured expenditure; protein 1.2–2.0 g/kg; carbs scaled to load | Mifflin et al. 1990; Thomas, Erdman & Burke 2016 |

DOIs are checked when each formula is implemented.

---

## 7. Advice

**Layer 1 — rules** (`packages/metrics/rules`): versioned functions that emit `findings` with evidence (metric, value, baseline, window, record IDs) and confidence. Examples: `HRV_BELOW_NORMAL`, `SLEEP_SHORT`, `SLEEP_IRREGULAR`, `LOAD_SPIKE`, `DETRAINING`, `RHR_ELEVATED`, `MISSING_OVERNIGHT_DATA`, `PLAN_VS_READINESS`.

**Layer 2 — wording:**
- **Template insights** written directly from findings. They are always available and are the default.
- **Optional AI wording via Groq** (switch in Settings, off by default). The model receives a compact evidence packet and returns `{headline, body, actions[], evidence_ids[], confidence, missing_data[]}`. Validators run before display: every number must match the packet, every action cites a finding, missing data must be acknowledged, and a safety filter blocks diagnosis, medication or supplement dosing and extreme diets. On failure: retry once, then use the template.
- Every insight shows "Based on: …" chips, a confidence badge and explicit "Not available: …" lines.

**Insights:** morning (after sleep data arrives, or wake time + 45 min), post-workout, evening, weekly. Delivered in-app, plus Web Push once the PWA is installed.

**Chat (Phase 3):** read-only typed tools (`get_daily_metrics`, `get_trend`, `compare_periods`, `list_activities`, `get_activity`, `get_sleep`, `get_findings`, `get_data_availability`, `explain_metric`), never raw SQL. Same validators. Results capped at about 366 points.

**Medical boundaries:** "general wellness information, not medical advice" in the footer and on every insight. Red-flag rules run before any AI and use fixed wording pointing to **GP / NHS 111 / 999**: resting HR > baseline + 10 bpm for ≥ 3 days or > 100 bpm sustained; repeated overnight SpO2 average < 90%; implausible activity HR (possible sensor issue); > 5% unintended weight loss in 30 days; chat messages mentioning chest pain, fainting, breathlessness at rest or palpitations.

---

## 8. Pages

| Page | Contents |
|---|---|
| **Today** | Morning insight; readiness gauge with components and confidence; last night's sleep hypnogram; HRV and resting HR vs baseline band; data freshness; key-expiry warning |
| **Activities** | List with filters; detail with 2D/3D map, HR/pace/power/elevation charts, laps, time in zones, load, RPE, comparison with similar activities |
| **Trends** | CTL/ATL/TSB, ACWR band, HRV and resting HR bands, sleep-consistency heatmap, VO2 max, weight, intensity minutes vs WHO target |
| **Dashboard** (Phase 3) | Chart builder over the metric registry: overlays on dual axes, period comparison, templates (running, cycling, strength, sleep & recovery, body, nutrition) |
| **Training** (Phase 3) | Plan calendar, plan templates, workout builder. Plans stay in the app: pushing to the watch needs Garmin Starter. |
| **Nutrition** (Phase 3) | Diary, barcode scan (Open Food Facts), custom foods, adaptive targets |
| **Chat** (Phase 3) | Questions about my data, with charts and evidence chips |
| **Settings** | Garmin key box and connection status; sync status, errors and quarantine; database size; units, time zone, insight times; AI switch; export all data; delete Garmin data |

**Not feasible on the web:** Live Activity, LiveTrack, watch widgets, Garmin's trail database, pushing workouts or courses (needs Starter), Garmin's exclusive badges.

---

## 9. Security & privacy

- **Login:** Supabase Auth email + password (min 8 characters), open sign-up. Optional TOTP two-step verification per account (Settings → Security); once on, the proxy requires it for every page and API route. Sign-in errors don't reveal whether an account exists.
- **Secrets:** Garmin key and token in Supabase Vault; service-role key and `CRON_SECRET` only in Vercel server environment variables; nothing secret in the client bundle (checked in CI by scanning the build output).
- **Database:** RLS enabled on every table; the anon key can't read anything without my session. `raw_ingest` kept 30 days.
- **Transport:** HTTPS everywhere (Vercel, Supabase, Garmin).
- **Processors:** Vercel (hosting; health data passes through its functions), Supabase (Frankfurt), Groq (US, only if a user switches AI on; zero data retention on).
- **Data rights for every user:** export everything as a zip of JSON/CSV; delete Garmin data; **delete account** (removes the auth user, which cascades to all their rows and Vault secrets).
- **UK GDPR:** other people's health data (special category) is stored, so the household exemption no longer applies. Needed: a short **privacy notice** shown at sign-up (what's stored, where, processors, retention, how to delete), explicit consent at sign-up for health-data processing, and a separate opt-in before any data goes to Groq.
- **Abuse limits:** Supabase Auth rate limits on sign-up/sign-in; per-user caps on stored activity streams so one account can't fill the 500 MB database.
- **Regulatory:** stay a wellness tool with no diagnostic claims.

---

## 10. Testing

- **Unit (Vitest):** unit conversions; local-date attribution (DST, travel, sleep dated to wake); token handling (reuse, refresh before expiry, 401 → expired); job planner (backfill chunking, overlap); every derived formula against hand-computed golden values; each rule fires or doesn't with the right evidence.
- **Contract:** Zod schemas for every Garmin endpoint run against fixtures in CI; a weekly check validates live responses from my account to catch upstream changes.
- **Integration:** Supabase local stack (Docker) + MSW-mocked Garmin: tick → jobs → canonical rows → derived values; idempotent re-sync creates no duplicates; Vault functions not callable by `anon` or `authenticated`.
- **Security:** anon key can't read any table; `/api/sync/tick` rejects a missing or wrong secret; `/api/garmin/key` rejects unauthenticated requests; the client bundle contains no secrets.
- **E2E (Playwright):** log in → paste key (mocked Garmin) → backfill completes → Today shows data and an insight with evidence chips → export → delete.
- **Advice evaluation:** 30+ synthetic days (poor sleep + low HRV, load spike, illness-like resting-HR rise, missing HRV, < 14 days of data, travel, red flags). Hard checks must pass 100%: numbers grounded, evidence cited, missing data acknowledged, red-flag templates used.

---

## 11. Roadmap

Effort assumes full-time work; multiply by about 3–4 for evenings and weekends.

| Phase | Scope | Effort |
|---|---|---|
| **0 — Foundations** | GitHub repo; Supabase project (Frankfurt); Vercel project linked to the repo (`fra1`); monorepo scaffold, lint, typecheck, Vitest, CI; Drizzle schema + RLS; Supabase Auth (email + password sign-up, optional TOTP); metric registry, units, time helpers; deploy a "hello" page behind login. | 3–5 days |
| **1 — MVP** | Garmin key box + Vault; token handling; sync tick + Supabase Cron; backfill and incremental sync for dailies, sleep, HRV, stress / Body Battery, user metrics, activities (+ details / FIT if available); canonical tables; derived v1 (TRIMP, CTL/ATL/TSB, HRV and resting-HR baselines, sleep debt, readiness); rules v1 incl. red flags; **template** morning insight; Today, Activities (list, detail, 2D map, charts), basic Trends; Settings (connection, sync status, export, delete). | 2–3 wk |
| **2 — AI and insights** | Groq wording with validators and the eval suite; post-workout, evening and weekly insights; Web Push. | 1–2 wk |
| **3 — More features** | Dashboard builder; chat with tools; RPE capture; training plans (in-app); nutrition; 3D maps; year-end recap. | 4–6 wk |
| **4 — Later** | Apple Health import; Garmin account export importer; critical speed / power and race predictor refinements; self-hosted map tiles. | Open-ended |

---

## 12. Risks & open questions

| Risk | Impact | Mitigation |
|---|---|---|
| Personal API lacks some data types, FIT files or deep history | Thinner dashboards | Confirm in Phase 1 (§1); Garmin account export importer as fallback. |
| Key expires (max 1 year) and is shown only once | Sync stops | Expiry warnings at 14 / 7 / 1 days; clear "key expired" state; paste a new key. |
| Garmin changes or withdraws the Personal API (the program closed once before) | No new data | Data already synced stays; export importer as fallback. |
| Supabase Free: 500 MB limit, pausing after inactivity | Full database or paused app | 1 Hz streams, FIT files in Storage, size shown in Settings; regular cron activity; confirm pausing behaviour. |
| Vercel Hobby function time limit | Long backfill fails | Small jobs, about 40 s per tick, resumable. |
| Groq free quota or policy changes | No AI wording | Templates are the default; AI is optional. |
| AI produces wrong numbers or unsafe advice | Bad advice | Rules first, numeric grounding validator, fixed red-flag wording, eval gate. |
| Leaked service-role key or `CRON_SECRET` | Data exposure | Server-only env vars, bundle scan in CI, rotate on suspicion. |
| Garmin objects to a personal-key app used by several people | Key or developer account revoked | Accepted risk; existing data stays; fall back to account-export import. |
| Open sign-up abused (junk accounts, storage, sync load) | Quota exhaustion | Auth rate limits, per-user storage caps, cron processes a bounded number of jobs per tick across all users. |

**To confirm during implementation** (recorded as ADRs): the five Personal API questions in §1; Vercel Hobby's current function duration limit; whether pg_net-triggered traffic keeps a free Supabase project from pausing; the current Groq free model list and limits; whether Supabase Auth passkeys are available.

---

## 13. Verification

- **Phase 0:** pushing to `main` deploys to Vercel; a new visitor can sign up and sign in; a second account can't read the first account's rows; turning on two-step verification makes the code required at the next sign-in; CI green (lint, typecheck, unit, RLS tests).
- **Phase 1:**
  1. Paste the key: Settings shows "key saved · expires in N days", and the key never appears in browser network responses.
  2. Backfill finishes; activity counts match Garmin Connect for the same date range.
  3. Record a short walk; within about 30 minutes of the watch syncing, it appears with charts and `derived_daily` updates.
  4. Next morning, the template insight cites the actual sleep, HRV and resting-HR values with confidence.
  5. Calling `/api/sync/tick` without the secret, or querying tables with the anon key, returns nothing.
- **Phase 2:** with Groq on, insights pass the validators and the eval suite meets the 100% hard-check bar; with Groq off, templates still appear.
- **Phase 3:** chat answers "How did my HRV change in the 2 weeks before my last long run?" with numbers matching SQL.

---

## Sources

- Garmin Personal API: [Personal API docs](https://developer.garmin.com/gc-developer-program/personal/personal-api) · [Personal API FAQ](https://developer.garmin.com/gc-developer-program/personal/personal-faq/) · [Developer program overview](https://developer.garmin.com/gc-developer-program/overview/) · [the5krunner: Garmin personal API (Oct 2026)](https://the5krunner.com/2026/10/22/garmin-personal-api/)
- Garmin Connect+ features: [the5krunner one-year review](https://the5krunner.com/2026/04/20/garmin-connect-plus-review/) · [Performance Dashboard](https://www.garmin.com/en-US/blog/fitness/what-is-the-garmin-connect-performance-dashboard/)
- Libraries: [@garmin/fitsdk](https://github.com/garmin/fit-javascript-sdk)
- Regulation: [ICO exemptions](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/exemptions/a-guide-to-the-data-protection-exemptions/) · [ASA: when health apps become medical devices](https://www.asa.org.uk/news/a-pulse-check-for-health-apps-when-does-software-become-a-medical-device.html)
