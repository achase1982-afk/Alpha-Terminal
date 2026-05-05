-- LC130 equity history backfill (FMP), earnings surprises revenue columns, analyst consensus ranges

ALTER TABLE "earnings_surprises_history"
  ADD COLUMN IF NOT EXISTS "revenue_estimate" numeric,
  ADD COLUMN IF NOT EXISTS "revenue_actual" numeric,
  ADD COLUMN IF NOT EXISTS "revenue_surprise_pct" numeric;

CREATE TABLE IF NOT EXISTS "analyst_estimates" (
  "id" serial PRIMARY KEY NOT NULL,
  "ticker" text NOT NULL,
  "fiscal_period_end" date NOT NULL,
  "eps_avg" numeric,
  "eps_high" numeric,
  "eps_low" numeric,
  "revenue_avg" numeric,
  "revenue_high" numeric,
  "revenue_low" numeric,
  "analyst_count_eps" integer,
  "analyst_count_revenue" integer,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "analyst_estimates_ticker_period_unique" UNIQUE ("ticker", "fiscal_period_end")
);

CREATE INDEX IF NOT EXISTS "idx_analyst_estimates_ticker_period"
  ON "analyst_estimates" ("ticker", "fiscal_period_end" DESC);
