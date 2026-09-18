-- Strategist outcome scoreboard: realized P&L per recommendation, marked at time stop / expiry.
CREATE TABLE IF NOT EXISTS "strategist_outcomes" (
  "id" serial PRIMARY KEY NOT NULL,
  "history_id" integer NOT NULL,
  "job_id" text NOT NULL,
  "user_id" text,
  "ticker" text NOT NULL,
  "signal_at" timestamp NOT NULL,
  "mode" text,
  "provider" text,
  "model_name" text,
  "strategy_type" text,
  "family" text,
  "direction" text,
  "confidence" real,
  "legs" jsonb NOT NULL,
  "entry_value" real NOT NULL,
  "max_risk" real,
  "max_profit" real,
  "expiration" date NOT NULL,
  "time_stop" date,
  "mark_due" date NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "mark_date" date,
  "mark_source" text,
  "mark_value" real,
  "underlying_at_mark" real,
  "pnl_per_share" real,
  "pnl_pct_of_risk" real,
  "outcome" text,
  "scored_at" timestamp,
  "unscorable_reason" text,
  "attempts" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "strategist_outcomes_history_uq" ON "strategist_outcomes" ("history_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strategist_outcomes_status_due_idx" ON "strategist_outcomes" ("status", "mark_due");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "strategist_outcomes_user_signal_idx" ON "strategist_outcomes" ("user_id", "signal_at");
