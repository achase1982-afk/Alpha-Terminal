ALTER TABLE options_flow_raw_trades
  ADD COLUMN IF NOT EXISTS source_trade_id text;

CREATE UNIQUE INDEX IF NOT EXISTS options_flow_raw_trades_source_dedup_idx
  ON options_flow_raw_trades (underlying_symbol, date, source_trade_id)
  WHERE source_trade_id IS NOT NULL;
