CREATE TABLE "profile" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"timezone" text DEFAULT 'Europe/London' NOT NULL,
	"birth_year" smallint,
	"sex" text,
	"height_cm" real,
	"units" text DEFAULT 'metric' NOT NULL,
	"sleep_need_min" integer DEFAULT 480 NOT NULL,
	"ai_enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profile" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_physiology" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"hr_max" smallint,
	"hr_max_source" text,
	"hr_rest_baseline" smallint,
	"lthr" smallint,
	"ftp_w" smallint,
	"threshold_pace_s_per_km" real,
	"zone_model" text DEFAULT 'hrr' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_physiology" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "garmin_connection" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"key_expires_on" date,
	"token_expires_at" timestamp with time zone,
	"last_synced_at" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"backfill_complete" boolean DEFAULT false NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "garmin_connection" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "raw_ingest" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text DEFAULT 'garmin' NOT NULL,
	"endpoint" text NOT NULL,
	"range_from" timestamp with time zone,
	"range_to" timestamp with time zone,
	"payload" jsonb NOT NULL,
	"sha256" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "raw_ingest" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"data_type" text NOT NULL,
	"range_from" timestamp with time zone NOT NULL,
	"range_to" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "metric_definitions" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"unit" text NOT NULL,
	"kind" text NOT NULL,
	"agg" text NOT NULL,
	"comparable_group" text NOT NULL,
	"garmin_native" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "metric_definitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "profile" ADD CONSTRAINT "profile_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_physiology" ADD CONSTRAINT "user_physiology_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "garmin_connection" ADD CONSTRAINT "garmin_connection_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_ingest" ADD CONSTRAINT "raw_ingest_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "raw_ingest_received_idx" ON "raw_ingest" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "raw_ingest_unprocessed_idx" ON "raw_ingest" USING btree ("user_id") WHERE processed_at is null;--> statement-breakpoint
CREATE INDEX "sync_jobs_claim_idx" ON "sync_jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_jobs_range_uq" ON "sync_jobs" USING btree ("user_id","data_type","range_from","range_to");--> statement-breakpoint
CREATE POLICY "profile_owner_all" ON "profile" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);--> statement-breakpoint
CREATE POLICY "user_physiology_owner_all" ON "user_physiology" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);--> statement-breakpoint
CREATE POLICY "garmin_connection_owner_all" ON "garmin_connection" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);--> statement-breakpoint
CREATE POLICY "raw_ingest_owner_all" ON "raw_ingest" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);--> statement-breakpoint
CREATE POLICY "sync_jobs_owner_all" ON "sync_jobs" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);--> statement-breakpoint
CREATE POLICY "metric_definitions_authenticated_read" ON "metric_definitions" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);