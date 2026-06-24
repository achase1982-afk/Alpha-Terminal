ALTER TABLE auto_trade_config ALTER COLUMN instrument_mode SET DEFAULT 'both';
ALTER TABLE auto_trade_config ALTER COLUMN total_budget SET DEFAULT 500;
ALTER TABLE auto_trade_config ALTER COLUMN max_per_trade SET DEFAULT 100;
ALTER TABLE auto_trade_config ALTER COLUMN daily_max_loss SET DEFAULT 150;

ALTER TABLE auto_trade_config DROP COLUMN IF EXISTS enable_extended_hours;
ALTER TABLE auto_trade_config DROP COLUMN IF EXISTS flatten_at_close;
