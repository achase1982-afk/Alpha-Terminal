CREATE TABLE IF NOT EXISTS options_tape_backfill_occ_cache (
  id serial PRIMARY KEY,
  ticker text NOT NULL,
  session_date date NOT NULL,
  occ text NOT NULL,
  last_coverage_end_ns bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticker, session_date, occ)
);

CREATE INDEX IF NOT EXISTS options_tape_backfill_occ_cache_ticker_date_idx
  ON options_tape_backfill_occ_cache (ticker, session_date);
