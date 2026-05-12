-- Tuning universe backfill: options_daily, dividends, earnings_reactions, audit;
-- corporate_events actuals; equity_daily hv_60d; idempotent split rows.

ALTER TABLE "corporate_events" ADD COLUMN IF NOT EXISTS "earnings_eps_actual" double precision;
--> statement-breakpoint
ALTER TABLE "corporate_events" ADD COLUMN IF NOT EXISTS "earnings_revenue_actual" double precision;
--> statement-breakpoint
ALTER TABLE "equity_daily" ADD COLUMN IF NOT EXISTS "hv_60d" real;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "corp_events_split_only_sym_date"
ON "corporate_events" ("symbol", "split_date")
WHERE "earnings_date" IS NULL AND "split_date" IS NOT NULL;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "options_daily" (
  "occ" text NOT NULL,
  "date" date NOT NULL,
  "open" real,
  "high" real,
  "low" real,
  "close" real NOT NULL,
  "volume" bigint,
  "vwap" real,
  "transactions" integer,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "options_daily_occ_date_pk" PRIMARY KEY ("occ", "date")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_options_daily_occ_date_desc" ON "options_daily" ("occ", "date" DESC);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "dividends" (
  "symbol" text NOT NULL,
  "ex_date" date NOT NULL,
  "cash_amount" double precision,
  "record_date" date,
  "pay_date" date,
  "declaration_date" date,
  "currency" text,
  "fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "dividends_symbol_ex_pk" PRIMARY KEY ("symbol", "ex_date")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_dividends_symbol_ex_desc" ON "dividends" ("symbol", "ex_date" DESC);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "earnings_reactions" (
  "symbol" text NOT NULL,
  "earnings_date" date NOT NULL,
  "t_zero_date" date NOT NULL,
  "time_of_day" text NOT NULL,
  "pre_event_close" double precision,
  "event_open" double precision,
  "event_close" double precision,
  "tplus1_close" double precision,
  "tplus5_close" double precision,
  "gap_pct" double precision,
  "intraday_pct" double precision,
  "reaction_1d_pct" double precision,
  "reaction_5d_pct" double precision,
  "drift_post_initial_pct" double precision,
  "max_drawdown_5d_pct" double precision,
  "max_upmove_5d_pct" double precision,
  "volume_vs_20d_avg" double precision,
  "eps_estimate" double precision,
  "eps_actual" double precision,
  "eps_surprise_pct" double precision,
  "revenue_estimate" double precision,
  "revenue_actual" double precision,
  "revenue_surprise_pct" double precision,
  "computed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "earnings_reactions_sym_earn_pk" PRIMARY KEY ("symbol", "earnings_date")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_earnings_reactions_symbol_date" ON "earnings_reactions" ("symbol", "earnings_date" DESC);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "backfill_audit_runs" (
  "run_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "started_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone,
  "universe" text NOT NULL,
  "universe_size" integer NOT NULL,
  "per_symbol_audit" jsonb NOT NULL,
  "overall_status" text NOT NULL,
  "notes" text
);
