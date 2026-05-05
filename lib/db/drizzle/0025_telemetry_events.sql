-- TODO: telemetry_events has no retention policy. Table grows unbounded.
-- Options: rolling window cleanup job, daily partitioning with auto-drop, external archival.
-- Decide before Layer 2 sustained traffic. Not in scope for this PR.

CREATE TABLE IF NOT EXISTS "telemetry_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"emitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"system" text NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"subsystem" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "telemetry_events_emitted_at_idx" ON "telemetry_events" USING btree ("emitted_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "telemetry_events_message_emitted_at_idx" ON "telemetry_events" USING btree ("message","emitted_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "telemetry_events_system_emitted_at_idx" ON "telemetry_events" USING btree ("system","emitted_at" DESC);
