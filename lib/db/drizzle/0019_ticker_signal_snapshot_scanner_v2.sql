-- Scanner scoring v1: cached earnings-edge stats, implied-move richness proxy note,
-- liquidity anchor columns.

ALTER TABLE ticker_signal_snapshot
  ADD COLUMN IF NOT EXISTS earnings_edge_signature JSONB,
  ADD COLUMN IF NOT EXISTS implied_move_richness JSONB,
  ADD COLUMN IF NOT EXISTS liquidity_anchor_score NUMERIC,
  ADD COLUMN IF NOT EXISTS liquidity_max_oi_band INTEGER,
  ADD COLUMN IF NOT EXISTS liquidity_deepest_oi_strike NUMERIC,
  ADD COLUMN IF NOT EXISTS surfacing_sub_scores TEXT[];
