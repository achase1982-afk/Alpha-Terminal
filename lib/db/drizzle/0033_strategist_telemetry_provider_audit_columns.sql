-- Conviction Desk multi-provider audit: provider column + rename Anthropic-specific columns.
-- Qualify public.strategist_telemetry — Drizzle defaults to public; current_schema() mismatches break self-heal.
ALTER TABLE public.strategist_telemetry ADD COLUMN IF NOT EXISTS "provider" text;

DO $$
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
END $$;

DO $$
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
END $$;
