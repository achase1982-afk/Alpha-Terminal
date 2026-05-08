ALTER TABLE "options_daily" ADD COLUMN IF NOT EXISTS "underlying_symbol" text;

UPDATE "options_daily"
SET "underlying_symbol" = (regexp_match("occ", '^O:([A-Z]{1,6})(?=[0-9])'))[1]
WHERE "underlying_symbol" IS NULL AND "occ" ~ '^O:[A-Z]{1,6}[0-9]';

CREATE INDEX IF NOT EXISTS "idx_options_daily_underlying_symbol" ON "options_daily" ("underlying_symbol");
