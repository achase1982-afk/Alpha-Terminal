ALTER TABLE auto_trade_config ADD COLUMN IF NOT EXISTS enable_extended_hours boolean NOT NULL DEFAULT false;
ALTER TABLE auto_trade_config ADD COLUMN IF NOT EXISTS flatten_at_close boolean NOT NULL DEFAULT true;
