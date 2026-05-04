-- Open / close position hint from Polygon unified trade conditions (Massive ids).
-- Application writes open | close | unknown; historical rows remain NULL until backfilled.

ALTER TABLE options_flow_raw_trades
  ADD COLUMN IF NOT EXISTS open_close text;
