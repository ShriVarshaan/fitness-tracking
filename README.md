# Fitness tracking

A personal training and recovery app for Garmin data, built to run for £0: dashboards, trends, grounded insights and chat, performance estimates, training plans, nutrition and a year in review.

- **App:** Next.js on Vercel (Hobby)
- **Data, login, secrets, scheduling:** Supabase (Free, Frankfurt)
- **Data sources:** Garmin Personal API key, pasted into the app's Settings page; older Garmin history and Apple Health from their export files (Settings → Import, read in the browser)

The full design is in [`docs/PLAN.md`](docs/PLAN.md).

## Layout

```
apps/web/         Next.js app (pages, API routes, auth proxy)
packages/core/    units, time and metric registry
packages/db/      Drizzle schema with row-level security
packages/garmin/  Garmin Personal API client, mappers and FIT decoding
packages/metrics/ derived metrics and rules (pure, with golden tests)
packages/advice/  insight templates, validators and AI rewording
supabase/         Supabase CLI config and SQL migrations
```

## Development

Requires Node 24 and pnpm.

```sh
pnpm install
cp .env.example apps/web/.env.local   # then fill in the values
pnpm dev
```

Checks: `pnpm lint`, `pnpm typecheck`, `pnpm test`, or all three with `pnpm check`.

### Database changes

Edit the schema in `packages/db/src/schema/`, then:

```sh
pnpm db:generate                  # writes SQL to supabase/migrations/
pnpm exec supabase db push        # applies it to the linked Supabase project
```
