-- Add provider column to strategist_telemetry if it doesn't already exist.
-- Column rename operations (anthropic_request_id -> provider_request_id,
-- extended_thinking_config -> thinking_config) have been removed because
-- those source columns were never created and the renames are not needed.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'strategist_telemetry' AND column_name = 'provider'
  ) THEN
    ALTER TABLE public.strategist_telemetry ADD COLUMN "provider" text;
  END IF;
END $$;
