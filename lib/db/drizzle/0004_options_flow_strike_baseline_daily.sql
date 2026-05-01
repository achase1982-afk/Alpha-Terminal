-- Item 3: per-strike rolling volume baseline snapshot table (20d avg as-of session date)

CREATE TABLE IF NOT EXISTS options_flow_strike_baseline_daily (
  id serial PRIMARY KEY,
  ticker text NOT NULL,
  option_symbol text NOT NULL,
  baseline_date date NOT NULL,
  avg_volume_20d double precision NOT NULL,
  days_observed integer NOT NULL,
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS options_flow_strike_baseline_daily_uniq
  ON options_flow_strike_baseline_daily (option_symbol, baseline_date);

CREATE INDEX IF NOT EXISTS options_flow_strike_baseline_daily_ticker_date_idx
  ON options_flow_strike_baseline_daily (ticker, baseline_date);
