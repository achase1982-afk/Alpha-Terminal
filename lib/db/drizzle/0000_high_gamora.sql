CREATE TABLE IF NOT EXISTS "ai_lab_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ai_lab_config_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_lab_deliberations" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"symbol" text NOT NULL,
	"source" text NOT NULL,
	"analyst_model_name" text,
	"critic_model_name" text,
	"input_snapshot" jsonb,
	"primary_proposal" jsonb,
	"skeptic_critique" jsonb,
	"final_decision" jsonb,
	"idea_id" integer,
	"conversation_log" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_lab_embeddings" (
	"id" serial PRIMARY KEY NOT NULL,
	"idea_id" integer NOT NULL,
	"embedding" jsonb,
	"tags" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_lab_idea_outcomes" (
	"id" serial PRIMARY KEY NOT NULL,
	"idea_id" integer NOT NULL,
	"evaluated_at" timestamp DEFAULT now() NOT NULL,
	"entry_price" double precision,
	"exit_price" double precision,
	"max_favorable_excursion" double precision,
	"max_adverse_excursion" double precision,
	"pnl_pct" double precision,
	"pnl_multiple" double precision,
	"hit_target" boolean,
	"hit_stop" boolean,
	"went_nowhere" boolean,
	"evaluation_completed_at" timestamp,
	"regime_at_exit" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_lab_ideas" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"origin_type" text DEFAULT 'AI_LAB' NOT NULL,
	"analyst_model_name" text DEFAULT 'claude-sonnet' NOT NULL,
	"critic_model_name" text,
	"symbol" text NOT NULL,
	"direction" text NOT NULL,
	"instrument_type" text NOT NULL,
	"option_structure_type" text,
	"legs" jsonb,
	"entry_zone" jsonb,
	"soft_stop" double precision,
	"target_zone" jsonb,
	"time_horizon" text DEFAULT '3-10D' NOT NULL,
	"thesis" text NOT NULL,
	"catalyst" text NOT NULL,
	"invalidation" text NOT NULL,
	"regime_fit" text DEFAULT 'NEUTRAL' NOT NULL,
	"main_signals" jsonb,
	"scanner_alignment_at_creation" jsonb,
	"signal_strength" integer DEFAULT 50 NOT NULL,
	"conviction_level" text DEFAULT 'MEDIUM' NOT NULL,
	"uncertainty" jsonb,
	"entry_spread_pct" double precision,
	"oi_at_entry" integer,
	"volume_at_entry" integer,
	"volume_to_oi_ratio" double precision,
	"regime_at_creation" text,
	"analyst_note" text,
	"critic_note" text,
	"primary_proposal" jsonb,
	"skeptic_critique" jsonb,
	"final_decision" jsonb,
	"status" text DEFAULT 'NEW' NOT NULL,
	"invalidated_reason" text,
	"closed_at" timestamp,
	"sector" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_lab_prompts" (
	"id" serial PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"prompt_text" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_lab_watchlist" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"anomaly_types" jsonb,
	"anomaly_scores" jsonb,
	"composite_score" integer DEFAULT 0 NOT NULL,
	"pass_name" text DEFAULT 'OVERNIGHT_DIGEST' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "corporate_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"earnings_date" date,
	"earnings_timing" text,
	"split_date" date,
	"split_ratio" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "equity_daily" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"date" date NOT NULL,
	"open" real,
	"high" real,
	"low" real,
	"close" real NOT NULL,
	"adjusted_close" real,
	"volume" bigint,
	"market_cap" bigint,
	"halt_status" boolean DEFAULT false,
	"ivr" real,
	"iv_30d" real,
	"iv_30d_proxy" real,
	"ivr_source" text,
	"hv_20d" real,
	"hv_30d" real,
	"put_call_ratio" real,
	"sma_20" real,
	"atr_5" real,
	"atr_20" real,
	"median_volume_5d" bigint,
	"median_volume_20d" bigint,
	"obv" bigint,
	"rs_ratio" real,
	"price_change_pct_5d" real,
	"price_change_pct_10d" real,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "equity_iv_canonical" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"date" date NOT NULL,
	"iv_30d" real NOT NULL,
	"dte_actual" integer NOT NULL,
	"strike" real NOT NULL,
	"spot" real NOT NULL,
	"source" text DEFAULT 'chain' NOT NULL,
	"collected_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "failure_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"system" text NOT NULL,
	"severity" text NOT NULL,
	"message" text NOT NULL,
	"details" jsonb,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_at" timestamp
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "flow_daily_aggregates" (
	"id" serial PRIMARY KEY NOT NULL,
	"underlying_symbol" text NOT NULL,
	"date" date NOT NULL,
	"total_call_volume" integer,
	"total_put_volume" integer,
	"total_oi" integer,
	"total_options_notional" double precision,
	"avg_vol_oi_ratio" real,
	"pc_skew" real,
	"block_count" integer,
	"block_notional_total" double precision,
	"avg_daily_options_notional_20d" double precision,
	"flow_direction" text,
	"num_sweeps" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ivr_backfill_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"source" text DEFAULT 'none' NOT NULL,
	"days_requested" integer DEFAULT 252 NOT NULL,
	"days_loaded" integer DEFAULT 0 NOT NULL,
	"equity_rows_written" integer DEFAULT 0 NOT NULL,
	"iv_rows_written" integer DEFAULT 0 NOT NULL,
	"ivr_rows_written" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"error_msg" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "options_chain_daily" (
	"id" serial PRIMARY KEY NOT NULL,
	"underlying_symbol" text NOT NULL,
	"date" date NOT NULL,
	"option_symbol" text,
	"option_type" text NOT NULL,
	"strike" real NOT NULL,
	"expiration" date NOT NULL,
	"dte" integer,
	"bid" real,
	"ask" real,
	"mid" real,
	"last" real,
	"volume" integer,
	"open_interest" integer,
	"implied_volatility" real,
	"delta" real,
	"gamma" real,
	"theta" real,
	"vega" real,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "options_flow_exec_per_strike" (
	"id" serial PRIMARY KEY NOT NULL,
	"underlying_symbol" text NOT NULL,
	"date" date NOT NULL,
	"option_type" text NOT NULL,
	"strike" real NOT NULL,
	"expiration" date NOT NULL,
	"sweep_count" integer DEFAULT 0 NOT NULL,
	"block_count" integer DEFAULT 0 NOT NULL,
	"regular_count" integer DEFAULT 0 NOT NULL,
	"sweep_notional" double precision DEFAULT 0 NOT NULL,
	"block_notional" double precision DEFAULT 0 NOT NULL,
	"regular_notional" double precision DEFAULT 0 NOT NULL,
	"sweep_volume" integer DEFAULT 0 NOT NULL,
	"block_volume" integer DEFAULT 0 NOT NULL,
	"regular_volume" integer DEFAULT 0 NOT NULL,
	"last_event_ts" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "options_flow_per_strike" (
	"id" serial PRIMARY KEY NOT NULL,
	"underlying_symbol" text NOT NULL,
	"date" date NOT NULL,
	"option_type" text NOT NULL,
	"strike" real NOT NULL,
	"expiration" date NOT NULL,
	"dte" integer,
	"daily_volume" integer,
	"open_interest" integer,
	"bid" real,
	"ask" real,
	"mid" real,
	"implied_volatility" real,
	"delta" real,
	"gamma" real,
	"theta" real,
	"vega" real,
	"avg_trade_price" real,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "options_flow_raw_trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"underlying_symbol" text NOT NULL,
	"date" date NOT NULL,
	"timestamp" timestamp,
	"option_symbol" text,
	"option_type" text NOT NULL,
	"strike" real NOT NULL,
	"expiration" date NOT NULL,
	"trade_price" real,
	"size" integer,
	"notional" double precision,
	"side" text,
	"is_block" boolean DEFAULT false,
	"is_sweep" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "polygon_options_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticker" text NOT NULL,
	"option_symbol" text NOT NULL,
	"trade_date" text NOT NULL,
	"volume" integer DEFAULT 0,
	"open_interest" integer,
	"close_price" real,
	"vwap" real,
	"strike" real,
	"expiry" text,
	"put_call" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "polygon_sync_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"trade_date" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"rows_inserted" integer DEFAULT 0,
	"tickers" jsonb,
	"synced_at" timestamp DEFAULT now() NOT NULL,
	"error_msg" text,
	CONSTRAINT "polygon_sync_log_trade_date_unique" UNIQUE("trade_date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reference_data" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"sector_etf" text,
	"is_adr" boolean DEFAULT false,
	"ipo_date" date,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "reference_data_symbol_unique" UNIQUE("symbol")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scanner_screens" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"cached_symbols" jsonb,
	"cached_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scanner_telemetry" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"mode" text NOT NULL,
	"regime" jsonb,
	"weights_used" jsonb,
	"universe_size" integer,
	"passed_filters" integer,
	"above_threshold" integer,
	"threshold_used" integer,
	"catalyst_bonus_applied_to" jsonb,
	"results" jsonb
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "scanner_watchlists" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"symbols" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_protected" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "snapshot_collection_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"equity_rows" integer DEFAULT 0,
	"chain_rows" integer DEFAULT 0,
	"flow_rows" integer DEFAULT 0,
	"aggregate_rows" integer DEFAULT 0,
	"error_msg" text,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "snapshot_collection_log_date_unique" UNIQUE("date")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "staged_exits" (
	"id" serial PRIMARY KEY NOT NULL,
	"journal_entry_id" integer,
	"schwab_entry_order_id" text,
	"schwab_exit_order_id" text,
	"symbol" text NOT NULL,
	"exit_type" text NOT NULL,
	"target_price" real,
	"entry_credit" real,
	"strategy_type" text,
	"dte" integer,
	"entry_timestamp" timestamp,
	"stop_alert_sent" boolean DEFAULT false,
	"time_alert_50_sent" boolean DEFAULT false,
	"time_alert_75_sent" boolean DEFAULT false,
	"expiration_alert_sent" boolean DEFAULT false,
	"status" text DEFAULT 'ACTIVE',
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "strategist_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"ticker" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"card_json" jsonb NOT NULL,
	"cleared" boolean DEFAULT false NOT NULL,
	"cleared_at" timestamp,
	CONSTRAINT "strategist_history_job_id_unique" UNIQUE("job_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "strategist_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" double precision NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "strategist_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "strategist_telemetry" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	"ticker" text NOT NULL,
	"result" text NOT NULL,
	"regime" jsonb,
	"ticker_data" jsonb,
	"idio_score" jsonb,
	"toxic_gate" jsonb,
	"viability" jsonb,
	"earnings_gate" jsonb,
	"strategy_decision" jsonb,
	"candidates_generated" integer,
	"candidates_filtered" integer,
	"filter_reasons" jsonb,
	"winning_candidate" jsonb,
	"edge_attribution" jsonb,
	"recommendation_thesis" text,
	"data_package" jsonb,
	"raw_ai_response" text,
	"confidence_base" real,
	"confidence_catalyst_delta" real,
	"confidence_final" real,
	"catalyst_alignment" text,
	"data_source" text,
	"fetch_failure_mode" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "terminal_watchlists" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"client_id" text NOT NULL,
	"name" text NOT NULL,
	"symbols" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tracked_tickers" (
	"symbol" text PRIMARY KEY NOT NULL,
	"source" text DEFAULT 'strategist_on_demand' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"first_requested_at" timestamp DEFAULT now() NOT NULL,
	"last_requested_at" timestamp DEFAULT now() NOT NULL,
	"last_snapshot_at" timestamp,
	"last_ivr_backfill_job_id" text,
	"notes" text,
	"error_msg" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trade_journal" (
	"id" serial PRIMARY KEY NOT NULL,
	"schwab_order_id" text,
	"symbol" text NOT NULL,
	"strategy_type" text,
	"direction" text,
	"pulse_composite" real,
	"pulse_confidence" real,
	"pulse_bias" text,
	"scanner_score" real,
	"trading_mode" integer,
	"trading_mode_label" text,
	"event_conflicts" jsonb,
	"ivr" real,
	"entry_price" real,
	"is_credit" boolean,
	"max_loss" real,
	"max_gain" real,
	"thesis" text,
	"legs" jsonb,
	"quantity" integer,
	"account_hash" text,
	"exit_price" real,
	"realized_pl" real,
	"result_note" text,
	"followed_plan" boolean,
	"result_logged_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_lab_ideas_sym_status" ON "ai_lab_ideas" USING btree ("symbol","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_lab_wl_sym_pass" ON "ai_lab_watchlist" USING btree ("symbol","pass_name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "corp_events_sym" ON "corporate_events" USING btree ("symbol");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "eq_daily_sym_date" ON "equity_daily" USING btree ("symbol","date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "eq_iv_canon_sym_date" ON "equity_iv_canonical" USING btree ("symbol","date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "flow_agg_unique" ON "flow_daily_aggregates" USING btree ("underlying_symbol","date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ivr_backfill_jobs_symbol_status_idx" ON "ivr_backfill_jobs" USING btree ("symbol","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "opt_chain_unique" ON "options_chain_daily" USING btree ("underlying_symbol","date","option_type","strike","expiration");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "flow_exec_strike_unique" ON "options_flow_exec_per_strike" USING btree ("underlying_symbol","date","option_type","strike","expiration");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "flow_exec_sym_date" ON "options_flow_exec_per_strike" USING btree ("underlying_symbol","date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "flow_strike_unique" ON "options_flow_per_strike" USING btree ("underlying_symbol","date","option_type","strike","expiration");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pol_opt_unique" ON "polygon_options_history" USING btree ("option_symbol","trade_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pol_opt_ticker_date_idx" ON "polygon_options_history" USING btree ("ticker","trade_date");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "terminal_watchlists_user_client" ON "terminal_watchlists" USING btree ("user_id","client_id");