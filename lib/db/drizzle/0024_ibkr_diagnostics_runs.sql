CREATE TABLE IF NOT EXISTS "ibkr_diagnostics_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_started_at" timestamp with time zone NOT NULL,
	"run_completed_at" timestamp with time zone NOT NULL,
	"duration_sec" integer NOT NULL,
	"client_id" integer NOT NULL,
	"per_symbol_results" jsonb NOT NULL,
	"global_errors" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"triggered_by_user_id" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ibkr_diagnostics_runs_started_idx" ON "ibkr_diagnostics_runs" ("run_started_at" DESC);
