-- Outcome columns: close the loop between BUY and SELL so we know P&L and hold time.
ALTER TABLE auto_trade_decisions
  ADD COLUMN IF NOT EXISTS exit_price   real,
  ADD COLUMN IF NOT EXISTS exit_at      timestamp,
  ADD COLUMN IF NOT EXISTS pnl          real,
  ADD COLUMN IF NOT EXISTS hold_minutes integer,
  ADD COLUMN IF NOT EXISTS outcome      text;  -- 'WIN' | 'LOSS' | 'BREAKEVEN'

-- Per-user LLM trading pattern playbook (generated nightly, injected into every decision call).
CREATE TABLE IF NOT EXISTS auto_trade_playbook (
  user_id      text      PRIMARY KEY,
  content      text      NOT NULL DEFAULT '',
  generated_at timestamp NOT NULL DEFAULT now(),
  trade_count  integer   NOT NULL DEFAULT 0
);
