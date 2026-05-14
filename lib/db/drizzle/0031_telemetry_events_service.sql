-- Origin column for unified logs UI (server vs web client).
ALTER TABLE telemetry_events ADD COLUMN IF NOT EXISTS service text NOT NULL DEFAULT 'server';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS telemetry_events_service_emitted_at_idx ON telemetry_events (service, emitted_at DESC);
