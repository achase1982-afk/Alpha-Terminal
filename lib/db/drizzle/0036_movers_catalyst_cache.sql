CREATE TABLE IF NOT EXISTS "movers_catalyst_cache" (
  "news_key" text PRIMARY KEY NOT NULL,
  "read" text NOT NULL,
  "posture" text NOT NULL,
  "confidence" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "movers_catalyst_cache_created_at_idx" ON "movers_catalyst_cache" ("created_at");
