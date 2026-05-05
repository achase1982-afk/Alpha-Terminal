-- Wall-clock duration for last strategist tape backfill run (per ticker/session row).

ALTER TABLE scanner_tape_metrics
  ADD COLUMN IF NOT EXISTS duration_ms INTEGER;
