ALTER TABLE auto_trade_config ADD COLUMN IF NOT EXISTS enable_extended_hours boolean NOT NULL DEFAULT false;
ALTER TABLE auto_trade_config ADD COLUMN IF NOT EXISTS flatten_at_close boolean NOT NULL DEFAULT true;

-- Retune scalping defaults for a ~$1k account (applies to future inserts only;
-- existing rows keep their values and can be changed in the settings UI).
ALTER TABLE auto_trade_config ALTER COLUMN instrument_mode SET DEFAULT 'stock';
ALTER TABLE auto_trade_config ALTER COLUMN total_budget SET DEFAULT 1000;
ALTER TABLE auto_trade_config ALTER COLUMN max_per_trade SET DEFAULT 300;
ALTER TABLE auto_trade_config ALTER COLUMN daily_max_loss SET DEFAULT 100;
