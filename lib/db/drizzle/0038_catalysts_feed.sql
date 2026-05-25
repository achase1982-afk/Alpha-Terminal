CREATE TABLE IF NOT EXISTS "catalysts_feed" (
  "id" serial PRIMARY KEY NOT NULL,
  "built_at" timestamp with time zone NOT NULL,
  "payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalysts_feed_built_at_idx" ON "catalysts_feed" ("built_at" DESC);
