-- Append-only log for tape backfill OCC coverage (one row per completed run).
-- scanner_tape_metrics remains the latest snapshot per (ticker, session_date); this table
-- supports reports across multiple snapshot cycles (e.g. last 10 worker cycles).

CREATE TABLE IF NOT EXISTS scanner_tape_metrics_cycle_log (
  id                    SERIAL PRIMARY KEY,
  ticker                TEXT NOT NULL,
  session_date          DATE NOT NULL,
  recorded_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  chain_contract_count  INTEGER,
  occ_requested         INTEGER NOT NULL DEFAULT 0,
  occ_completed         INTEGER NOT NULL DEFAULT 0,
  trades_attempted_insert INTEGER NOT NULL DEFAULT 0,
  trades_inserted_committed INTEGER NOT NULL DEFAULT 0,
  dedupe_dropped        INTEGER NOT NULL DEFAULT 0,
  any_truncated         BOOLEAN NOT NULL DEFAULT false,
  status                TEXT NOT NULL,
  duration_ms           INTEGER,
  polygon_http_timeout_ms INTEGER,
  symbol_budget_ms      INTEGER
);

CREATE INDEX IF NOT EXISTS scanner_tape_cycle_log_ticker_recorded_idx
  ON scanner_tape_metrics_cycle_log (ticker, recorded_at DESC);

CREATE INDEX IF NOT EXISTS scanner_tape_cycle_log_recorded_idx
  ON scanner_tape_metrics_cycle_log (recorded_at DESC);
