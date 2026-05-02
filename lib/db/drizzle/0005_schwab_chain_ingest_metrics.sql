CREATE TABLE IF NOT EXISTS "schwab_chain_ingest_metrics" (
  "underlying_symbol" text NOT NULL,
  "session_date" date NOT NULL,
  "range_all_status" text NOT NULL,
  "last_attempt_at" timestamptz NOT NULL,
  "last_failure_reason" text,
  "range_all_failures_total" integer NOT NULL DEFAULT 0,
  "bracketed_fallback_success_total" integer NOT NULL DEFAULT 0,
  "total_failure_total" integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "schwab_chain_ingest_metrics_sym_date" ON "schwab_chain_ingest_metrics" USING btree ("underlying_symbol","session_date");
