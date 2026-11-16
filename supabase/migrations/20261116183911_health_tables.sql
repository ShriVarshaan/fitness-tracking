CREATE TABLE "daily_summaries" (
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"tz_offset_min" smallint,
	"steps" integer,
	"steps_goal" integer,
	"distance_m" real,
	"floors_ascended" real,
	"total_kcal" real,
	"active_kcal" real,
	"resting_kcal" real,
	"intensity_min_moderate" smallint,
	"intensity_min_vigorous" smallint,
	"intensity_min_goal" smallint,
	"resting_hr" smallint,
	"min_hr" smallint,
	"max_hr" smallint,
	"stress_avg" smallint,
	"stress_max" smallint,
	"stress_rest_s" integer,
	"stress_low_s" integer,
	"stress_medium_s" integer,
	"stress_high_s" integer,
	"body_battery_high" smallint,
	"body_battery_low" smallint,
	"body_battery_charged" smallint,
	"body_battery_drained" smallint,
	"spo2_avg" real,
	"spo2_min" real,
	"respiration_avg" real,
	"respiration_min" real,
	"respiration_max" real,
	"source" text DEFAULT 'garmin' NOT NULL,
	"source_record_id" text,
	"raw_ingest_id" bigint,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_summaries_user_id_local_date_source_pk" PRIMARY KEY("user_id","local_date","source")
);
--> statement-breakpoint
ALTER TABLE "daily_summaries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "hrv_daily" (
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"last_night_avg_ms" real,
	"last_night_5min_high_ms" real,
	"weekly_avg_ms" real,
	"baseline_low_upper_ms" real,
	"baseline_balanced_low_ms" real,
	"baseline_balanced_upper_ms" real,
	"source_status" text,
	"source" text DEFAULT 'garmin' NOT NULL,
	"source_record_id" text,
	"raw_ingest_id" bigint,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hrv_daily_user_id_local_date_source_pk" PRIMARY KEY("user_id","local_date","source")
);
--> statement-breakpoint
ALTER TABLE "hrv_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sleep_sessions" (
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"tz_offset_min" smallint,
	"total_sleep_s" integer,
	"deep_s" integer,
	"light_s" integer,
	"rem_s" integer,
	"awake_s" integer,
	"unmeasurable_s" integer,
	"nap_s" integer,
	"awake_count" smallint,
	"source_score" smallint,
	"source_score_qualifier" text,
	"sleep_need_min" smallint,
	"avg_hr" real,
	"avg_spo2" real,
	"lowest_spo2" real,
	"avg_respiration" real,
	"avg_sleep_stress" real,
	"source" text DEFAULT 'garmin' NOT NULL,
	"source_record_id" text,
	"raw_ingest_id" bigint,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sleep_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "daily_summaries" ADD CONSTRAINT "daily_summaries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hrv_daily" ADD CONSTRAINT "hrv_daily_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sleep_sessions" ADD CONSTRAINT "sleep_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sleep_sessions_source_uq" ON "sleep_sessions" USING btree ("user_id","source","source_record_id");--> statement-breakpoint
CREATE INDEX "sleep_sessions_user_date_idx" ON "sleep_sessions" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE POLICY "daily_summaries_owner_read" ON "daily_summaries" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = user_id);--> statement-breakpoint
CREATE POLICY "hrv_daily_owner_read" ON "hrv_daily" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = user_id);--> statement-breakpoint
CREATE POLICY "sleep_sessions_owner_read" ON "sleep_sessions" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = user_id);