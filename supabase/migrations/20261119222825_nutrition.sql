CREATE TABLE "body_measurements" (
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"weight_kg" real NOT NULL,
	"body_fat_pct" real,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "body_measurements_user_id_local_date_source_pk" PRIMARY KEY("user_id","local_date","source"),
	CONSTRAINT "body_measurements_weight_range" CHECK ("body_measurements"."weight_kg" between 20 and 400),
	CONSTRAINT "body_measurements_fat_range" CHECK ("body_measurements"."body_fat_pct" is null or "body_measurements"."body_fat_pct" between 2 and 75)
);
--> statement-breakpoint
ALTER TABLE "body_measurements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "food_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"local_date" date NOT NULL,
	"meal" text NOT NULL,
	"name" text NOT NULL,
	"grams" real NOT NULL,
	"kcal" real NOT NULL,
	"protein_g" real,
	"carbs_g" real,
	"fat_g" real,
	"fibre_g" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_log_grams_range" CHECK ("food_log"."grams" > 0 and "food_log"."grams" <= 5000),
	CONSTRAINT "food_log_name_length" CHECK (char_length("food_log"."name") between 1 and 160)
);
--> statement-breakpoint
ALTER TABLE "food_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "foods" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"barcode" text,
	"kcal_100g" real NOT NULL,
	"protein_100g" real,
	"carbs_100g" real,
	"fat_100g" real,
	"fibre_100g" real,
	"serving_g" real,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "foods_name_length" CHECK (char_length("foods"."name") between 1 and 120),
	CONSTRAINT "foods_nutrients_range" CHECK ("foods"."kcal_100g" between 0 and 900 and coalesce("foods"."protein_100g", 0) between 0 and 100 and coalesce("foods"."carbs_100g", 0) between 0 and 100 and coalesce("foods"."fat_100g", 0) between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "foods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "profile" ADD COLUMN "nutrition_goal" text DEFAULT 'maintain' NOT NULL;--> statement-breakpoint
ALTER TABLE "body_measurements" ADD CONSTRAINT "body_measurements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_log" ADD CONSTRAINT "food_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "foods" ADD CONSTRAINT "foods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "food_log_user_date_idx" ON "food_log" USING btree ("user_id","local_date");--> statement-breakpoint
CREATE INDEX "foods_user_name_idx" ON "foods" USING btree ("user_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "foods_user_barcode_uq" ON "foods" USING btree ("user_id","barcode");--> statement-breakpoint
CREATE POLICY "body_measurements_owner_all" ON "body_measurements" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);--> statement-breakpoint
CREATE POLICY "food_log_owner_all" ON "food_log" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);--> statement-breakpoint
CREATE POLICY "foods_owner_all" ON "foods" AS PERMISSIVE FOR ALL TO "authenticated" USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);