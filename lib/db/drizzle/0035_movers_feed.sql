CREATE TABLE IF NOT EXISTS "movers_feed" (
  "id" serial PRIMARY KEY NOT NULL,
  "captured_at" timestamp with time zone NOT NULL,
  "payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "movers_feed_captured_at_idx" ON "movers_feed" ("captured_at" DESC);
