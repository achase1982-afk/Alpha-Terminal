CREATE TABLE IF NOT EXISTS "chat_threads" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "symbol" text,
  "title" text DEFAULT 'Chat' NOT NULL,
  "summary" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chat_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "thread_id" uuid NOT NULL REFERENCES "chat_threads"("id") ON DELETE CASCADE,
  "role" text NOT NULL,
  "content" text DEFAULT '' NOT NULL,
  "tool_calls" jsonb,
  "tool_results" jsonb,
  "token_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_threads_user_symbol_updated_idx"
  ON "chat_threads" ("user_id", "symbol", "updated_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_messages_thread_created_idx"
  ON "chat_messages" ("thread_id", "created_at");
