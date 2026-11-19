CREATE TABLE IF NOT EXISTS "journal_books" (
  "account_ref" text PRIMARY KEY NOT NULL,
  "label" text NOT NULL,
  "paper" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journal_position_watch" (
  "position_id" text PRIMARY KEY NOT NULL,
  "account_ref" text NOT NULL,
  "opened_at" timestamp with time zone NOT NULL,
  "closed_at" timestamp with time zone,
  "status" text NOT NULL,
  "started_late" boolean DEFAULT false NOT NULL,
  "legs" jsonb NOT NULL,
  "metrics" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journal_position_quote" (
  "id" text PRIMARY KEY NOT NULL,
  "position_id" text NOT NULL,
  "ts" timestamp with time zone NOT NULL,
  "valid" boolean DEFAULT false NOT NULL,
  "unrealized" double precision,
  "legs" jsonb NOT NULL,
  "source" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_position_quote_position_idx" ON "journal_position_quote" ("position_id", "ts");
