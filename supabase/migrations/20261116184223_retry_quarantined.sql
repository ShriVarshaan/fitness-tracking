-- Mappers now handle empty sleep nights, activities and VO2 max:
-- clear the quarantine flag so those stored responses are processed again.
update public.raw_ingest set error = null
where processed_at is null
  and endpoint in ('sleep_summaries', 'activities_search', 'vo2max_daily');
