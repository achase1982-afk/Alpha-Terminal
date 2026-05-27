CREATE TYPE "strategist_job_status" AS ENUM(
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled'
);
--> statement-breakpoint
CREATE TYPE "strategist_job_kind" AS ENUM(
  'analyze',
  'validate_trade'
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "strategist_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "kind" "strategist_job_kind" NOT NULL,
  "ticker" text NOT NULL,
  "params" jsonb NOT NULL,
  "status" "strategist_job_status" DEFAULT 'queued' NOT NULL,
  "phase" text,
  "last_completed_phase" text,
  "progress" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "result_history_id" integer,
  "error" jsonb,
  "priority" integer DEFAULT 0 NOT NULL,
  "attempt" integer DEFAULT 0 NOT NULL,
  "worker_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "started_at" timestamp with time zone,
  "last_heartbeat_at" timestamp with time zone,
  "completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_strategist_jobs_queue"
  ON "strategist_jobs" ("status", "priority" DESC, "created_at" ASC)
  WHERE "status" = 'queued';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_strategist_jobs_dedup"
  ON "strategist_jobs" ("user_id", "kind", "ticker")
  WHERE "status" IN ('queued', 'running');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_strategist_jobs_user_recent"
  ON "strategist_jobs" ("user_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_strategist_jobs_heartbeat"
  ON "strategist_jobs" ("last_heartbeat_at")
  WHERE "status" = 'running';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_strategist_jobs_resumable"
  ON "strategist_jobs" ("status", "last_completed_phase")
  WHERE "status" = 'running' AND "last_completed_phase" IS NOT NULL;
