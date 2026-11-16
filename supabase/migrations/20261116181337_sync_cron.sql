-- Supabase Cron calls the app's sync endpoint every 5 minutes.
-- The app URL and shared secret are read from Vault at run time, so neither is
-- stored in this file. Set them once with `pnpm sync:secrets` (scripts/set-sync-secrets.ts).
-- The endpoint plans incremental jobs at most every 30 minutes per user, so most
-- ticks only continue history loading or exit quickly.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
--> statement-breakpoint

create or replace function private.call_sync_tick()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url');
  v_secret text := (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret');
begin
  if v_url is null or v_secret is null then
    raise notice 'sync tick skipped: app_url or cron_secret missing from Vault';
    return null;
  end if;
  return net.http_post(
    url := v_url || '/api/sync/tick',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;
--> statement-breakpoint

revoke all on function private.call_sync_tick() from public, anon, authenticated;
--> statement-breakpoint

select cron.unschedule('garmin-sync-tick') where exists (select 1 from cron.job where jobname = 'garmin-sync-tick');
select cron.schedule('garmin-sync-tick', '*/5 * * * *', 'select private.call_sync_tick()');
