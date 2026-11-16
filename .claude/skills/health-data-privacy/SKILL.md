---
name: health-data-privacy
description: Use when touching database schema, RLS policies, queries, Supabase Auth/login, API routes, the Garmin API key or Vault, env vars and secrets, logging, data export/delete, or adding any new third-party service in this health tracker with open sign-up (Next.js on Vercel + Supabase). Checklist for RLS, secret handling, minimisation and non-medical framing.
---

# Health data privacy & security

Design: `docs/PLAN.md` §3 (key handling) and §9. Anyone can sign up (recruiters, etc.), so the app holds **other people's health data** (UK GDPR special category). Every account must see only its own data.

## Checklist for any change

- **RLS on every table.** Every table has `user_id uuid` (= `auth.uid()`) and RLS enabled with an owner policy (`auth.uid() = user_id`). New tables get a test that the anon key and a second user read nothing of the first user's.
- **Never trust a client-supplied user id.** Server code that uses the privileged DB connection takes `user_id` from the verified session (`getClaims()`), never from the request body, query or an LLM tool argument.
- **Login:** Supabase Auth email + password, open sign-up. `src/proxy.ts` requires a session on every page and API route except `/login`, `/auth/*` and `/api/sync/tick`, and requires AAL2 for accounts that turned on two-step verification. Auth error messages never reveal whether an account exists.
- **Secrets never reach the client.** Garmin API key and access token live in Supabase Vault, read/written only via `SECURITY DEFINER` functions granted to `service_role`. `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `GROQ_API_KEY`, `DATABASE_URL` are server-only env vars — never `NEXT_PUBLIC_*`, never imported from a client component (`import 'server-only'` in modules that use them). API responses never echo the key or token.
- **`/api/sync/tick`** requires `Authorization: Bearer <CRON_SECRET>` (constant-time compare).
- **Logging:** ids, counts and durations only. Never log the key, tokens, raw payload bodies or health values.
- **Minimisation:** birth year, not date of birth; `raw_ingest` kept 30 days; LLM prompts/outputs kept 90 days (switch to turn off).
- **Data rights:** any new table must be covered by the export (JSON/CSV zip) and by delete-Garmin-data / delete-account (cascades from `auth.users`; Vault secrets deleted explicitly), with tests.
- **Consent:** health-data processing consent at sign-up (privacy notice); separate opt-in per user before any data goes to an LLM.
- **Abuse:** per-user caps on stored data and sync work, so one account can't exhaust shared free-tier quotas.
- **New third party receiving health data?** Note it in `docs/PLAN.md` §9 processor list; prefer UK/EU processing. AI (Groq) stays off unless that user switches it on in Settings.
- **Garmin Personal API terms:** follow whatever the ADR on Personal API terms records (attribution, storage, AI processing).
- **Wording:** wellness framing only; no diagnostic claims (MHRA intended-purpose test).
