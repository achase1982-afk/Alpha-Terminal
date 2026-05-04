-- Strategist-aligned scanner: precomputed per-ticker snapshots + health audit.
-- Drops legacy async scanner job queue (replaced by synchronous GET /api/v2/scan).

CREATE TABLE IF NOT EXISTS ticker_signal_snapshot (
  ticker                    TEXT PRIMARY KEY,
  sector                    TEXT,
  market_cap_tier           TEXT,
  spot                      NUMERIC,
  daily_change_pct          NUMERIC,
  halted                    BOOLEAN DEFAULT FALSE,
  ivr                       NUMERIC,
  ivr_source                TEXT,
  hv20                      NUMERIC,
  hv30                      NUMERIC,
  atm_iv_by_expiry          JSONB,
  skew_25d_by_expiry        JSONB,
  implied_move_front_pct    NUMERIC,
  implied_move_front_abs    NUMERIC,
  atm_oi_front              INTEGER,
  bid_ask_width_atm_front   NUMERIC,
  flow_summary              JSONB,
  earnings_date             DATE,
  earnings_days_away        INTEGER,
  earnings_confirmed        BOOLEAN,
  macro_overlap_score       NUMERIC,
  regime_shock_active       BOOLEAN DEFAULT FALSE,
  composite_score           NUMERIC,
  component_scores          JSONB,
  disqual_flags             TEXT[],
  surfacing_reasons         TEXT[],
  snapshot_at               TIMESTAMPTZ,
  last_attempt_at           TIMESTAMPTZ,
  last_success_at           TIMESTAMPTZ,
  chain_updated_at          TIMESTAMPTZ,
  flow_updated_at           TIMESTAMPTZ,
  ivr_updated_at            TIMESTAMPTZ,
  earnings_updated_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tss_composite ON ticker_signal_snapshot (composite_score DESC)
  WHERE (disqual_flags IS NULL OR cardinality(disqual_flags) = 0);

CREATE INDEX IF NOT EXISTS idx_tss_sector ON ticker_signal_snapshot (sector);

CREATE TABLE IF NOT EXISTS scanner_health (
  id                        SERIAL PRIMARY KEY,
  cycle_started_at          TIMESTAMPTZ,
  cycle_completed_at        TIMESTAMPTZ,
  tickers_attempted         INTEGER,
  tickers_succeeded         INTEGER,
  tickers_failed            INTEGER,
  failed_tickers            JSONB
);

CREATE INDEX IF NOT EXISTS idx_sh_completed ON scanner_health (cycle_completed_at DESC);

DROP TABLE IF EXISTS scanner_jobs;
