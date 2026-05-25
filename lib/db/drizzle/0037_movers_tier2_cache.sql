CREATE TABLE IF NOT EXISTS "movers_tier2_cache" (
  "headline_set_key" text PRIMARY KEY NOT NULL,
  "catalyst_type" text NOT NULL,
  "driving_headline" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "movers_tier2_cache_created_at_idx" ON "movers_tier2_cache" ("created_at");
