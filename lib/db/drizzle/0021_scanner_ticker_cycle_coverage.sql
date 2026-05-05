-- Per-ticker tape coverage per scanner_health cycle (historical analysis).

CREATE TABLE IF NOT EXISTS scanner_ticker_cycle_coverage (
  id                   SERIAL PRIMARY KEY,
  cycle_id             INTEGER NOT NULL REFERENCES scanner_health (id) ON DELETE CASCADE,
  ticker               TEXT NOT NULL,
  chain_contract_count INTEGER,
  occ_attempted        INTEGER NOT NULL DEFAULT 0,
  occ_completed        INTEGER NOT NULL DEFAULT 0,
  occ_coverage_pct     NUMERIC,
  trades_inserted      INTEGER NOT NULL DEFAULT 0,
  trades_observed      INTEGER,
  insert_coverage_pct  NUMERIC,
  truncated            BOOLEAN NOT NULL DEFAULT FALSE,
  elapsed_ms           INTEGER NOT NULL DEFAULT 0,
  tier                 TEXT NOT NULL,
  recorded_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scanner_ticker_cycle_cov_cycle_idx
  ON scanner_ticker_cycle_coverage (cycle_id);

CREATE INDEX IF NOT EXISTS scanner_ticker_cycle_cov_ticker_recorded_idx
  ON scanner_ticker_cycle_coverage (ticker, recorded_at DESC);

-- Raw trade rows returned from Polygon during tape backfill (session window); complements trades_attempted_insert.
ALTER TABLE scanner_tape_metrics
  ADD COLUMN IF NOT EXISTS trades_observed_polygon INTEGER;
