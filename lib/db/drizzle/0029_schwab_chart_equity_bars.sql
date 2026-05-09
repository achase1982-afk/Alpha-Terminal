-- Persisted Schwab CHART_EQUITY 1-minute bars for strategist VWAP/RSI after redeploys.
-- close/high/low/volume support volume-weighted typical-price VWAP; session_date is America/New_York calendar date of bar_time_ms.
CREATE TABLE schwab_chart_equity_bars (
  symbol text NOT NULL,
  bar_time_ms bigint NOT NULL,
  high numeric(20, 8) NOT NULL,
  low numeric(20, 8) NOT NULL,
  close numeric(20, 8) NOT NULL,
  volume numeric(24, 4) NOT NULL,
  session_date date NOT NULL,
  inserted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, bar_time_ms)
);

CREATE INDEX schwab_chart_equity_bars_symbol_session_date_idx
  ON schwab_chart_equity_bars (symbol, session_date);
