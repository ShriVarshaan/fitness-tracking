CREATE TABLE "derived_daily" (
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"metric_code" text NOT NULL,
	"value" real,
	"components" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"algo_version" smallint NOT NULL,
	"inputs_hash" text NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "derived_daily_user_id_local_date_metric_code_pk" PRIMARY KEY("user_id","local_date","metric_code")
);
--> statement-breakpoint
ALTER TABLE "derived_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "derived_daily" ADD CONSTRAINT "derived_daily_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "derived_daily_owner_read" ON "derived_daily" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = user_id);