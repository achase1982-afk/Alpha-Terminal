CREATE TABLE IF NOT EXISTS "journal_activities" (
  "id" text PRIMARY KEY NOT NULL,
  "account_ref" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "kind" text NOT NULL,
  "net_amount" double precision DEFAULT 0 NOT NULL,
  "fees" double precision DEFAULT 0 NOT NULL,
  "order_ref" text,
  "description" text DEFAULT '' NOT NULL,
  "legs" jsonb NOT NULL,
  "payload" jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_activities_account_time_idx" ON "journal_activities" ("account_ref", "occurred_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journal_orders" (
  "id" text PRIMARY KEY NOT NULL,
  "account_ref" text NOT NULL,
  "entered_at" timestamp with time zone NOT NULL,
  "closed_at" timestamp with time zone,
  "status" text DEFAULT '' NOT NULL,
  "legs" jsonb NOT NULL,
  "payload" jsonb
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_orders_account_idx" ON "journal_orders" ("account_ref", "entered_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journal_positions" (
  "id" text PRIMARY KEY NOT NULL,
  "account_ref" text NOT NULL,
  "strategy" text NOT NULL,
  "asset_class" text NOT NULL,
  "underlying" text DEFAULT '' NOT NULL,
  "label" text NOT NULL,
  "status" text NOT NULL,
  "opened_at" timestamp with time zone NOT NULL,
  "closed_at" timestamp with time zone,
  "ticket_at" timestamp with time zone NOT NULL,
  "quantity" double precision DEFAULT 0 NOT NULL,
  "remaining_qty" double precision DEFAULT 0 NOT NULL,
  "net_pnl" double precision DEFAULT 0 NOT NULL,
  "gross_pnl" double precision DEFAULT 0 NOT NULL,
  "fees" double precision DEFAULT 0 NOT NULL,
  "unrealized_pnl" double precision,
  "rolled_from_id" text,
  "legs" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_positions_account_idx" ON "journal_positions" ("account_ref", "closed_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journal_lots" (
  "id" text PRIMARY KEY NOT NULL,
  "account_ref" text NOT NULL,
  "position_id" text NOT NULL,
  "instrument_key" text NOT NULL,
  "side" text NOT NULL,
  "opened_at" timestamp with time zone NOT NULL,
  "closed_at" timestamp with time zone,
  "open_qty" double precision NOT NULL,
  "remaining_qty" double precision NOT NULL,
  "open_price" double precision NOT NULL,
  "multiplier" double precision NOT NULL,
  "fees" double precision DEFAULT 0 NOT NULL,
  "realized_pnl" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "journal_lots_account_idx" ON "journal_lots" ("account_ref", "instrument_key");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journal_sync_state" (
  "account_ref" text PRIMARY KEY NOT NULL,
  "backfill_complete" boolean DEFAULT false NOT NULL,
  "synced_through" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journal_equity_snapshots" (
  "account_ref" text NOT NULL,
  "captured_on" date NOT NULL,
  "liquidation_value" double precision NOT NULL,
  CONSTRAINT "journal_equity_snapshots_pk" PRIMARY KEY ("account_ref", "captured_on")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "journal_marks" (
  "account_ref" text NOT NULL,
  "instrument_key" text NOT NULL,
  "mid" double precision NOT NULL,
  "captured_at" timestamp with time zone NOT NULL,
  CONSTRAINT "journal_marks_pk" PRIMARY KEY ("account_ref", "instrument_key")
);
