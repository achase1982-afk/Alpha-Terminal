-- Conviction Desk multi-provider audit: provider column + rename Anthropic-specific columns.
-- Wrapped in a single DO block so every operation is guarded: the table-existence check
-- prevents any ALTER from running on a schema where 0032 has not yet been applied, and the
-- column-level guards make each rename idempotent regardless of prior partial runs.
DO $migration$
BEGIN
  -- Bail out entirely if the table does not exist (e.g. fresh DB mid-migration).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'strategist_telemetry'
  ) THEN
    RAISE NOTICE '0033: strategist_telemetry does not exist — skipping migration.';
    RETURN;
  END IF;

  -- Add provider column (idempotent).
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'strategist_telemetry' AND column_name = 'provider'
  ) THEN
    ALTER TABLE public.strategist_telemetry ADD COLUMN "provider" text;
  END IF;

  -- Rename anthropic_request_id -> provider_request_id only when source exists and target does not.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'strategist_telemetry' AND column_name = 'anthropic_request_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'strategist_telemetry' AND column_name = 'provider_request_id'
  ) THEN
    ALTER TABLE public.strategist_telemetry RENAME COLUMN anthropic_request_id TO provider_request_id;
  END IF;

  -- Rename extended_thinking_config -> thinking_config only when source exists and target does not.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'strategist_telemetry' AND column_name = 'extended_thinking_config'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'strategist_telemetry' AND column_name = 'thinking_config'
  ) THEN
    ALTER TABLE public.strategist_telemetry RENAME COLUMN extended_thinking_config TO thinking_config;
  END IF;

EXCEPTION WHEN others THEN
  RAISE EXCEPTION '0033: migration failed — %', SQLERRM;
END $migration$;
