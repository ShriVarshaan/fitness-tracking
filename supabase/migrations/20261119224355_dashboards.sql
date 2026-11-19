CREATE TABLE "dashboards" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"panels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dashboards_name_length" CHECK (char_length("dashboards"."name") between 1 and 60),
	CONSTRAINT "dashboards_panels_size" CHECK (jsonb_array_length("dashboards"."panels") <= 12)
);
--> statement-breakpoint
ALTER TABLE "dashboards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "dashboards_owner_all" ON "dashboards" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);