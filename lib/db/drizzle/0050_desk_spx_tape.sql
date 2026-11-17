CREATE TABLE IF NOT EXISTS "desk_spx_tape" (
  "id" serial PRIMARY KEY NOT NULL,
  "symbol" text NOT NULL,
  "ts" timestamp with time zone NOT NULL,
  "last" double precision,
  "bid" double precision,
  "ask" double precision,
  "inserted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "desk_spx_tape_symbol_ts_uidx" ON "desk_spx_tape" ("symbol", "ts");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "desk_spx_tape_ts_idx" ON "desk_spx_tape" ("ts" DESC);