CREATE TABLE "sleep_stages" (
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"local_date" date NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"stage" text NOT NULL,
	CONSTRAINT "sleep_stages_user_id_source_local_date_start_time_pk" PRIMARY KEY("user_id","source","local_date","start_time"),
	CONSTRAINT "sleep_stages_order" CHECK ("sleep_stages"."end_time" > "sleep_stages"."start_time")
);
--> statement-breakpoint
ALTER TABLE "sleep_stages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sleep_stages" ADD CONSTRAINT "sleep_stages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "sleep_stages_owner_read" ON "sleep_stages" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = user_id);