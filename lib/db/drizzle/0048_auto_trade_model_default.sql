-- LLM catalog refresh (2026-09): the auto trader defaults to Claude Opus 5.
-- Applies to future inserts only; existing rows keep their value and are
-- coerced onto the current catalog at read time (normalizeAiModelId).
ALTER TABLE auto_trade_config ALTER COLUMN model_id SET DEFAULT 'claude-opus-5';
