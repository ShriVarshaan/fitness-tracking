# Fitness tracking

A personal training and recovery dashboard for one person's Garmin data, built to run for £0.

- **App:** Next.js on Vercel (Hobby)
- **Data, login, secrets, scheduling:** Supabase (Free, London)
- **Data source:** Garmin Personal API key, pasted into the app's Settings page

The full design is in [`docs/PLAN.md`](docs/PLAN.md).

## Layout

```
apps/web/         Next.js app (pages, API routes, auth proxy)
packages/core/    units, time and metric registry
packages/db/      Drizzle schema with row-level security
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
