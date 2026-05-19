-- Conviction Desk multi-provider audit: provider column + rename Anthropic-specific columns.
-- Each operation is a standalone DO block so failures are isolated and every step is idempotent.

-- Add provider column if it doesn't already exist.
DO $
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'strategist_telemetry' AND column_name = 'provider'
  ) THEN
    ALTER TABLE public.strategist_telemetry ADD COLUMN "provider" text;
  END IF;
END $;

-- Rename anthropic_request_id -> provider_request_id only when source exists and target does not.
DO $
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'strategist_telemetry' AND column_name = 'anthropic_request_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'strategist_telemetry' AND column_name = 'provider_request_id'
  ) THEN
    ALTER TABLE public.strategist_telemetry RENAME COLUMN anthropic_request_id TO provider_request_id;
  END IF;
END $;

-- Rename extended_thinking_config -> thinking_config only when source exists and target does not.
DO $
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'strategist_telemetry' AND column_name = 'extended_thinking_config'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'strategist_telemetry' AND column_name = 'thinking_config'
  ) THEN
    ALTER TABLE public.strategist_telemetry RENAME COLUMN extended_thinking_config TO thinking_config;
  END IF;
END $;
