CREATE TABLE "planned_workouts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" bigint,
	"local_date" date NOT NULL,
	"sport" text NOT NULL,
	"title" text NOT NULL,
	"intensity" text NOT NULL,
	"target_duration_s" integer,
	"target_distance_m" real,
	"steps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "planned_workouts_title_length" CHECK (char_length("planned_workouts"."title") between 1 and 80),
	CONSTRAINT "planned_workouts_targets_range" CHECK (coalesce("planned_workouts"."target_duration_s", 0) between 0 and 86400 and coalesce("planned_workouts"."target_distance_m", 0) between 0 and 500000),
	CONSTRAINT "planned_workouts_steps_size" CHECK (jsonb_array_length("planned_workouts"."steps") <= 30),
	CONSTRAINT "planned_workouts_notes_length" CHECK ("planned_workouts"."notes" is null or char_length("planned_workouts"."notes") <= 500)
);
--> statement-breakpoint
ALTER TABLE "planned_workouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "training_plans" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"template" text,
	"start_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_plans_name_length" CHECK (char_length("training_plans"."name") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "training_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "planned_workouts" ADD CONSTRAINT "planned_workouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_workouts" ADD CONSTRAINT "planned_workouts_plan_id_training_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."training_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_plans" ADD CONSTRAINT "training_plans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "planned_workouts_user_date_idx" ON "planned_workouts" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE POLICY "planned_workouts_owner_all" ON "planned_workouts" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);--> statement-breakpoint
CREATE POLICY "training_plans_owner_all" ON "training_plans" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);