CREATE TABLE "findings" (
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"rule_id" text NOT NULL,
	"rule_version" smallint NOT NULL,
	"severity" text NOT NULL,
	"confidence" real NOT NULL,
	"evidence" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "findings_user_id_local_date_rule_id_pk" PRIMARY KEY("user_id","local_date","rule_id")
);
--> statement-breakpoint
ALTER TABLE "findings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "insights" (
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"for_date" date NOT NULL,
	"body" jsonb NOT NULL,
	"rule_ids" text[] NOT NULL,
	"model" text NOT NULL,
	"validator_ok" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "insights_user_id_kind_for_date_pk" PRIMARY KEY("user_id","kind","for_date")
);
--> statement-breakpoint
ALTER TABLE "insights" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insights" ADD CONSTRAINT "insights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "findings_owner_read" ON "findings" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = user_id);--> statement-breakpoint
CREATE POLICY "insights_owner_read" ON "insights" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = user_id);