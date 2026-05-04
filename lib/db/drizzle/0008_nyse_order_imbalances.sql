CREATE TABLE IF NOT EXISTS "nyse_order_imbalances" (
  "id" text PRIMARY KEY NOT NULL,
  "underlying_symbol" text NOT NULL,
  "imbalance_timestamp" timestamptz NOT NULL,
  "imbalance_shares" bigint NOT NULL,
  "imbalance_notional_usd" double precision NOT NULL,
  "indicative_price" double precision NOT NULL,
  "paired_shares" bigint,
  "regulatory_imbalance" bigint,
  "auction_type" text DEFAULT 'closing' NOT NULL,
  "source" text DEFAULT 'IBKR_NYSE' NOT NULL
);

CREATE INDEX IF NOT EXISTS "nyse_order_imbalances_sym_ts_idx"
  ON "nyse_order_imbalances" ("underlying_symbol", "imbalance_timestamp");

CREATE INDEX IF NOT EXISTS "nyse_order_imbalances_ts_idx"
  ON "nyse_order_imbalances" ("imbalance_timestamp");
