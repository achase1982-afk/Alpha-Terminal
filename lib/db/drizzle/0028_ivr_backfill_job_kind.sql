ALTER TABLE "ivr_backfill_jobs" ADD COLUMN IF NOT EXISTS "job_kind" text NOT NULL DEFAULT 'ondemand_ivr';
ALTER TABLE "ivr_backfill_jobs" ADD COLUMN IF NOT EXISTS "payload" jsonb;
