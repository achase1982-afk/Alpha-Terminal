-- Migration: create tracked_tickers and ivr_backfill_jobs tables
-- Idempotent (IF NOT EXISTS). Matches Drizzle schema in lib/db/src/schema/index.ts.

CREATE TABLE IF NOT EXISTS tracked_tickers (
  symbol                  text        PRIMARY KEY,
  source                  text        NOT NULL DEFAULT 'strategist_on_demand',
  active                  boolean     NOT NULL DEFAULT true,
  first_requested_at      timestamp   NOT NULL DEFAULT now(),
  last_requested_at       timestamp   NOT NULL DEFAULT now(),
  last_snapshot_at        timestamp,
  last_ivr_backfill_job_id text,
  notes                   text,
  error_msg               text
);

CREATE TABLE IF NOT EXISTS ivr_backfill_jobs (
  id                  text        PRIMARY KEY,
  symbol              text        NOT NULL,
  status              text        NOT NULL DEFAULT 'queued',
  source              text        NOT NULL DEFAULT 'none',
  days_requested      integer     NOT NULL DEFAULT 252,
  days_loaded         integer     NOT NULL DEFAULT 0,
  equity_rows_written integer     NOT NULL DEFAULT 0,
  iv_rows_written     integer     NOT NULL DEFAULT 0,
  ivr_rows_written    integer     NOT NULL DEFAULT 0,
  started_at          timestamp,
  completed_at        timestamp,
  error_msg           text,
  created_at          timestamp   NOT NULL DEFAULT now(),
  updated_at          timestamp   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ivr_backfill_jobs_symbol_status_idx
  ON ivr_backfill_jobs (symbol, status);
