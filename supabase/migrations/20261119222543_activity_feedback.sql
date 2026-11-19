CREATE TABLE "activity_feedback" (
	"user_id" uuid NOT NULL,
	"source" text DEFAULT 'garmin' NOT NULL,
	"source_record_id" text NOT NULL,
	"rpe" smallint,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_feedback_user_id_source_source_record_id_pk" PRIMARY KEY("user_id","source","source_record_id"),
	CONSTRAINT "activity_feedback_rpe_range" CHECK ("activity_feedback"."rpe" is null or "activity_feedback"."rpe" between 1 and 10),
	CONSTRAINT "activity_feedback_note_length" CHECK ("activity_feedback"."note" is null or char_length("activity_feedback"."note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "activity_feedback" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activity_feedback" ADD CONSTRAINT "activity_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "activity_feedback_owner_all" ON "activity_feedback" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);