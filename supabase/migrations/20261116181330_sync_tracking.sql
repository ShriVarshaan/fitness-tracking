ALTER TABLE "garmin_connection" ADD COLUMN "last_planned_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "raw_ingest_dedupe_idx" ON "raw_ingest" USING btree ("user_id","endpoint","sha256");--> statement-breakpoint
CREATE POLICY "garmin_connection_owner_read" ON "garmin_connection" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = user_id);--> statement-breakpoint
CREATE POLICY "raw_ingest_owner_read" ON "raw_ingest" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = user_id);--> statement-breakpoint
CREATE POLICY "sync_jobs_owner_read" ON "sync_jobs" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = user_id);