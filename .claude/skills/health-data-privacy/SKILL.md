---
name: health-data-privacy
description: Use when touching database schema, RLS policies, queries, Supabase Auth/login, API routes, the Garmin API key or Vault, env vars and secrets, logging, data export/delete, or adding any new third-party service in this single-user health tracker (Next.js on Vercel + Supabase). Checklist for RLS, secret handling, minimisation and non-medical framing.
---

# Health data privacy & security

Design: `docs/PLAN.md` §3 (key handling) and §9. One user (the owner), but the app is on the public internet and holds health data, so treat it as sensitive.

## Checklist for any change

- **RLS on every table.** Every table has `user_id uuid` (= `auth.uid()`) and RLS enabled with an owner policy (`auth.uid() = user_id`). New tables get a test that the anon key (and a second, non-owner auth user) reads nothing.
- **Login:** Supabase Auth only; sign-ups disabled; middleware enforces the `ALLOWED_EMAIL` allowlist and MFA (AAL2) on every app page and API route except `/login` and `/api/sync/tick`.
- **Secrets never reach the client.** Garmin API key and access token live in Supabase Vault, read/written only via `SECURITY DEFINER` functions granted to `service_role`. `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `GROQ_API_KEY`, `DATABASE_URL` are server-only env vars — never `NEXT_PUBLIC_*`, never imported from a client component (`import 'server-only'` in modules that use them). API responses never echo the key or token.
- **`/api/sync/tick`** requires `Authorization: Bearer <CRON_SECRET>` (constant-time compare).
- **Logging:** ids, counts and durations only. Never log the key, tokens, raw payload bodies or health values.
- **Minimisation:** birth year, not date of birth; `raw_ingest` kept 30 days; LLM prompts/outputs kept 90 days (switch to turn off).
- **Data rights:** any new table must be covered by the export (JSON/CSV zip) and the delete-Garmin-data / delete-everything actions, with tests.
- **New third party receiving health data?** Note it in `docs/PLAN.md` §9 processor list; prefer UK/EU processing. AI (Groq) stays off unless the owner switches it on in Settings.
- **Garmin Personal API terms:** follow whatever the ADR on Personal API terms records (attribution, storage, AI processing).
- **Wording:** wellness framing only; no diagnostic claims (MHRA intended-purpose test).
