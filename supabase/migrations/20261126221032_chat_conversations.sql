CREATE TABLE "chat_conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_conversations_id_user_key" UNIQUE("id","user_id"),
	CONSTRAINT "chat_conversations_title_length" CHECK (char_length("chat_conversations"."title") between 1 and 80)
);
--> statement-breakpoint
ALTER TABLE "chat_conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "conversation_id" uuid;--> statement-breakpoint
-- Hand-written: messages from before multiple chats go into one "Earlier chat" per user.
INSERT INTO "chat_conversations" ("id", "user_id", "title", "created_at", "updated_at")
SELECT gen_random_uuid(), "user_id", 'Earlier chat', min("created_at"), max("created_at") FROM "chat_messages" GROUP BY "user_id";--> statement-breakpoint
UPDATE "chat_messages" m SET "conversation_id" = c."id" FROM "chat_conversations" c WHERE c."user_id" = m."user_id" AND m."conversation_id" IS NULL;--> statement-breakpoint
ALTER TABLE "chat_messages" ALTER COLUMN "conversation_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_conversations_user_updated_idx" ON "chat_conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_fk" FOREIGN KEY ("conversation_id","user_id") REFERENCES "public"."chat_conversations"("id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_conversation_created_idx" ON "chat_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE POLICY "chat_conversations_owner_read" ON "chat_conversations" AS PERMISSIVE FOR SELECT TO "authenticated" USING ((select auth.uid()) = user_id);