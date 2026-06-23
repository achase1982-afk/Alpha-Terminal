DROP TABLE IF EXISTS auto_trade_playbook;

ALTER TABLE auto_trade_decisions
  DROP COLUMN IF EXISTS exit_price,
  DROP COLUMN IF EXISTS exit_at,
  DROP COLUMN IF EXISTS pnl,
  DROP COLUMN IF EXISTS hold_minutes,
  DROP COLUMN IF EXISTS outcome;
