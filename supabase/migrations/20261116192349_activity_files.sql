CREATE TABLE "activity_laps" (
	"user_id" uuid NOT NULL,
	"source" text DEFAULT 'garmin' NOT NULL,
	"source_record_id" text NOT NULL,
	"idx" smallint NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"duration_s" real,
	"distance_m" real,
	"avg_hr" real,
	"max_hr" real,
	"avg_speed_mps" real,
	"avg_power_w" real,
	"ascent_m" real,
	CONSTRAINT "activity_laps_user_id_source_source_record_id_idx_pk" PRIMARY KEY("user_id","source","source_record_id","idx")
);
--> statement-breakpoint
ALTER TABLE "activity_laps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "activity_sets" (
	"user_id" uuid NOT NULL,
	"source" text DEFAULT 'garmin' NOT NULL,
	"source_record_id" text NOT NULL,
	"idx" smallint NOT NULL,
	"exercise" text,
	"reps" smallint,
	"weight_kg" real,
	"duration_s" real,
	CONSTRAINT "activity_sets_user_id_source_source_record_id_idx_pk" PRIMARY KEY("user_id","source","source_record_id","idx")
);
--> statement-breakpoint
ALTER TABLE "activity_sets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "activity_streams" (
	"user_id" uuid NOT NULL,
	"source" text DEFAULT 'garmin' NOT NULL,
	"source_record_id" text NOT NULL,
	"stream" text NOT NULL,
	"values" real[] NOT NULL,
	CONSTRAINT "activity_streams_user_id_source_source_record_id_stream_pk" PRIMARY KEY("user_id","source","source_record_id","stream")
);
--> statement-breakpoint
ALTER TABLE "activity_streams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD COLUMN "ref" text;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "rpe" real;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "feel" real;--> statement-breakpoint
ALTER TABLE "activities" ADD COLUMN "file_fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "activity_laps" ADD CONSTRAINT "activity_laps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_sets" ADD CONSTRAINT "activity_sets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_streams" ADD CONSTRAINT "activity_streams_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "activity_laps_owner_read" ON "activity_laps" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = user_id);--> statement-breakpoint
CREATE POLICY "activity_sets_owner_read" ON "activity_sets" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = user_id);--> statement-breakpoint
CREATE POLICY "activity_streams_owner_read" ON "activity_streams" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = user_id);