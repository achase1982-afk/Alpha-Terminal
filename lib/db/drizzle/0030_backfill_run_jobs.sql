CREATE TABLE IF NOT EXISTS "backfill_run_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "finished_at" timestamptz,
  "status" text NOT NULL,
  "per_pipeline_progress" jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS "backfill_run_jobs_started_at_idx" ON "backfill_run_jobs" ("started_at" DESC);
