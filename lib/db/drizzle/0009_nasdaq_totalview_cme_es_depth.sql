CREATE TABLE IF NOT EXISTS "nasdaq_totalview_summary" (
  "id" text PRIMARY KEY NOT NULL,
  "underlying_symbol" text NOT NULL,
  "summary_timestamp" timestamptz NOT NULL,
  "spot_mid" double precision NOT NULL,
  "bid_depth_5pct" double precision NOT NULL,
  "ask_depth_5pct" double precision NOT NULL,
  "bid_depth_1pct" double precision NOT NULL,
  "ask_depth_1pct" double precision NOT NULL,
  "book_imbalance_ratio" double precision NOT NULL,
  "top_bid_size" double precision NOT NULL,
  "top_ask_size" double precision NOT NULL,
  "source" text DEFAULT 'IBKR_NASDAQ' NOT NULL
);

CREATE INDEX IF NOT EXISTS "nasdaq_totalview_summary_sym_ts_idx"
  ON "nasdaq_totalview_summary" ("underlying_symbol", "summary_timestamp");

CREATE INDEX IF NOT EXISTS "nasdaq_totalview_summary_ts_idx"
  ON "nasdaq_totalview_summary" ("summary_timestamp");

CREATE TABLE IF NOT EXISTS "cme_es_depth_summary" (
  "id" text PRIMARY KEY NOT NULL,
  "underlying_symbol" text DEFAULT 'ES' NOT NULL,
  "contract_month" text NOT NULL,
  "summary_timestamp" timestamptz NOT NULL,
  "mid_price" double precision NOT NULL,
  "bid_depth_5ticks" double precision NOT NULL,
  "ask_depth_5ticks" double precision NOT NULL,
  "bid_depth_1tick" double precision NOT NULL,
  "ask_depth_1tick" double precision NOT NULL,
  "book_imbalance_ratio" double precision NOT NULL,
  "top_bid_size" double precision NOT NULL,
  "top_ask_size" double precision NOT NULL,
  "source" text DEFAULT 'IBKR_CME' NOT NULL
);

CREATE INDEX IF NOT EXISTS "cme_es_depth_summary_ts_idx"
  ON "cme_es_depth_summary" ("summary_timestamp");
