-- Last tape backfill coverage snapshot per ticker/session for scanner graduated flow scoring.
CREATE TABLE IF NOT EXISTS scanner_tape_metrics (
  ticker text NOT NULL,
  session_date date NOT NULL,
  occ_requested integer NOT NULL DEFAULT 0,
  occ_completed integer NOT NULL DEFAULT 0,
  trades_attempted_insert integer NOT NULL DEFAULT 0,
  trades_inserted_committed integer NOT NULL DEFAULT 0,
  dedupe_dropped integer NOT NULL DEFAULT 0,
  any_truncated boolean NOT NULL DEFAULT false,
  status text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticker, session_date)
);

CREATE INDEX IF NOT EXISTS scanner_tape_metrics_ticker_updated_idx
  ON scanner_tape_metrics (ticker, updated_at DESC);
