CREATE TABLE IF NOT EXISTS "desk_api_snapshots" (
  "id" serial PRIMARY KEY NOT NULL,
  "kind" text NOT NULL,
  "symbol" text,
  "session_date" date NOT NULL,
  "captured_at" timestamp with time zone NOT NULL,
  "payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "desk_api_snapshots_kind_captured_idx" ON "desk_api_snapshots" ("kind", "captured_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "desk_api_snapshots_session_date_idx" ON "desk_api_snapshots" ("session_date");