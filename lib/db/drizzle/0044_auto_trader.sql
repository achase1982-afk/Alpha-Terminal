-- Auto Trader: per-user autonomous trading configuration + decision audit log.
-- One config row per user. tickers is the user-defined universe the LLM may trade.
-- daily_max_loss and total_budget are USD guardrails enforced by the engine before any order.
CREATE TABLE IF NOT EXISTS "auto_trade_config" (
  "user_id" text PRIMARY KEY NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "running" boolean DEFAULT false NOT NULL,
  "account_hash" text,
  "model_id" text DEFAULT 'claude-opus-4-8' NOT NULL,
  "tickers" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "instrument_mode" text DEFAULT 'both' NOT NULL,
  "total_budget" real DEFAULT 500 NOT NULL,
  "max_per_trade" real DEFAULT 100 NOT NULL,
  "daily_max_loss" real DEFAULT 150 NOT NULL,
  "poll_interval_sec" integer DEFAULT 60 NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auto_trade_decisions" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "ticker" text NOT NULL,
  "decision" text NOT NULL,
  "instrument" text,
  "quantity" integer,
  "notional" real,
  "reasoning" text,
  "model_id" text,
  "schwab_order_id" text,
  "placed" boolean DEFAULT false NOT NULL,
  "error" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auto_trade_decisions_user_created_idx"
  ON "auto_trade_decisions" ("user_id", "created_at" DESC);
