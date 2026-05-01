-- Item 28: options_flow_raw_trades — classification & context columns
-- (exchange, DTE, session phase, vol/OI, baselines, cap tier, multi-leg, extras)

ALTER TABLE options_flow_raw_trades
  ADD COLUMN IF NOT EXISTS exchange_id integer,
  ADD COLUMN IF NOT EXISTS venue_class text,
  ADD COLUMN IF NOT EXISTS dte_days integer,
  ADD COLUMN IF NOT EXISTS session_phase text,
  ADD COLUMN IF NOT EXISTS vol_oi_ratio real,
  ADD COLUMN IF NOT EXISTS open_interest_snapshot integer,
  ADD COLUMN IF NOT EXISTS volume_vs_baseline_20d real,
  ADD COLUMN IF NOT EXISTS market_cap_usd double precision,
  ADD COLUMN IF NOT EXISTS market_cap_tier text,
  ADD COLUMN IF NOT EXISTS notional_threshold_usd double precision,
  ADD COLUMN IF NOT EXISTS aggressor_confidence text,
  ADD COLUMN IF NOT EXISTS synthetic_leg_group_id text,
  ADD COLUMN IF NOT EXISTS multi_leg_confidence text,
  ADD COLUMN IF NOT EXISTS extras jsonb;

CREATE INDEX IF NOT EXISTS options_flow_raw_trades_sym_date_ts_idx
  ON options_flow_raw_trades (underlying_symbol, date, timestamp);

CREATE INDEX IF NOT EXISTS options_flow_raw_trades_leg_group_idx
  ON options_flow_raw_trades (synthetic_leg_group_id)
  WHERE synthetic_leg_group_id IS NOT NULL;
