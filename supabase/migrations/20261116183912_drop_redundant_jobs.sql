-- Stress and Body Battery now come from the daily summaries, so their separate
-- jobs and stored responses are no longer needed.
delete from public.sync_jobs where data_type in ('stress', 'body_battery');
--> statement-breakpoint
update public.raw_ingest set processed_at = now()
where endpoint in ('stress_daily', 'body_battery_daily') and processed_at is null;
