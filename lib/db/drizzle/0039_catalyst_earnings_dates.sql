CREATE TABLE IF NOT EXISTS "catalyst_earnings_dates" (
  "symbol" text PRIMARY KEY NOT NULL,
  "next_earnings_date" date,
  "earnings_confirmed" boolean,
  "harvested_at" timestamptz NOT NULL,
  "sweep_id" text
);

CREATE INDEX IF NOT EXISTS "catalyst_earnings_dates_next_date_idx"
  ON "catalyst_earnings_dates" ("next_earnings_date");

CREATE INDEX IF NOT EXISTS "catalyst_earnings_dates_harvested_at_idx"
  ON "catalyst_earnings_dates" ("harvested_at" DESC);
