-- Option A: FMP /stable/historical-price-eod/full returns split-adjusted OHLC; no separate adjClose.
-- Mirror close into adjusted_close wherever the latter was left null after backfill.

UPDATE equity_daily
SET adjusted_close = close
WHERE adjusted_close IS NULL
  AND close IS NOT NULL;
