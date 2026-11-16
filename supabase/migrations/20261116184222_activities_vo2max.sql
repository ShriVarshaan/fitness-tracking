CREATE TABLE "activities" (
	"user_id" uuid NOT NULL,
	"sport" text NOT NULL,
	"name" text,
	"start_time" timestamp with time zone NOT NULL,
	"tz_offset_min" smallint,
	"local_date" date NOT NULL,
	"duration_s" real,
	"moving_s" real,
	"distance_m" real,
	"ascent_m" real,
	"descent_m" real,
	"avg_hr" smallint,
	"max_hr" smallint,
	"avg_speed_mps" real,
	"max_speed_mps" real,
	"avg_power_w" real,
	"max_power_w" real,
	"norm_power_w" real,
	"avg_cadence" real,
	"kcal" real,
	"source_training_load" real,
	"aerobic_te" real,
	"anaerobic_te" real,
	"training_effect_label" text,
	"intensity_min_moderate" smallint,
	"intensity_min_vigorous" smallint,
	"hr_zone_s" real[],
	"lap_count" smallint,
	"has_route" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'garmin' NOT NULL,
	"source_record_id" text,
	"raw_ingest_id" bigint,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "activities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vo2max_daily" (
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"sport" text NOT NULL,
	"value" real NOT NULL,
	"source" text DEFAULT 'garmin' NOT NULL,
	"source_record_id" text,
	"raw_ingest_id" bigint,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vo2max_daily_user_id_local_date_sport_source_pk" PRIMARY KEY("user_id","local_date","sport","source")
);
--> statement-breakpoint
ALTER TABLE "vo2max_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vo2max_daily" ADD CONSTRAINT "vo2max_daily_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "activities_source_uq" ON "activities" USING btree ("user_id","source","source_record_id");--> statement-breakpoint
CREATE INDEX "activities_user_start_idx" ON "activities" USING btree ("user_id","start_time");--> statement-breakpoint
CREATE POLICY "activities_owner_read" ON "activities" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = user_id);--> statement-breakpoint
CREATE POLICY "vo2max_daily_owner_read" ON "vo2max_daily" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = user_id);