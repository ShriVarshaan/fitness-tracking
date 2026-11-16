ALTER TABLE "profile" ALTER COLUMN "ai_enabled" SET DEFAULT true;--> statement-breakpoint
-- AI wording is now opt-out: switch it on for existing profiles too.
update "profile" set "ai_enabled" = true where "ai_enabled" = false;
