-- Garmin secrets live in Supabase Vault (encrypted at rest), keyed per user:
--   garmin_api_key:<user_id>, garmin_access_token:<user_id>
-- Helpers sit in a `private` schema that the Data API does not expose, and only
-- privileged server roles may execute them. See docs/PLAN.md §3.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
--> statement-breakpoint

create or replace function private.set_secret(p_name text, p_value text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then
    perform vault.create_secret(p_value, p_name);
  else
    perform vault.update_secret(v_id, p_value);
  end if;
end;
$$;
--> statement-breakpoint

create or replace function private.get_secret(p_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1;
$$;
--> statement-breakpoint

create or replace function private.delete_secret(p_name text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from vault.secrets where name = p_name;
$$;
--> statement-breakpoint

revoke all on function private.set_secret(text, text) from public, anon, authenticated;
revoke all on function private.get_secret(text) from public, anon, authenticated;
revoke all on function private.delete_secret(text) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.set_secret(text, text) to service_role;
grant execute on function private.get_secret(text) to service_role;
grant execute on function private.delete_secret(text) to service_role;
--> statement-breakpoint

-- Metric registry seed (generated from packages/core/src/metrics.ts).
insert into public.metric_definitions (code, label, unit, kind, agg, comparable_group, garmin_native) values
  ('heart_rate', 'Heart rate', 'bpm', 'instant', 'avg', 'heart_rate', false),
  ('resting_hr', 'Resting heart rate', 'bpm', 'daily', 'last', 'resting_hr', false),
  ('hrv_rmssd_ms', 'HRV (RMSSD)', 'ms', 'instant', 'avg', 'hrv_rmssd', false),
  ('hrv_sdnn_ms', 'HRV (SDNN)', 'ms', 'instant', 'avg', 'hrv_sdnn', false),
  ('spo2', 'Pulse ox (SpO2)', 'pct', 'instant', 'avg', 'spo2', false),
  ('respiration_rate', 'Respiration rate', 'count', 'instant', 'avg', 'respiration', false),
  ('stress', 'Stress', 'count', 'instant', 'avg', 'garmin_stress', true),
  ('body_battery', 'Body Battery', 'count', 'instant', 'last', 'garmin_body_battery', true),
  ('steps', 'Steps', 'count', 'interval', 'sum', 'steps', false),
  ('distance', 'Distance', 'm', 'interval', 'sum', 'distance', false),
  ('active_kcal', 'Active calories', 'kcal', 'interval', 'sum', 'active_kcal', false),
  ('weight', 'Weight', 'kg', 'instant', 'last', 'weight', false),
  ('body_fat', 'Body fat', 'pct', 'instant', 'last', 'body_fat', false),
  ('vo2max', 'VO2 max', 'count', 'daily', 'last', 'garmin_vo2max', true),
  ('fitness_age', 'Fitness age', 'count', 'daily', 'last', 'garmin_fitness_age', true),
  ('skin_temp_delta', 'Skin temperature change', 'degC', 'daily', 'avg', 'skin_temp_delta', false)
on conflict (code) do update set
  label = excluded.label,
  unit = excluded.unit,
  kind = excluded.kind,
  agg = excluded.agg,
  comparable_group = excluded.comparable_group,
  garmin_native = excluded.garmin_native;
