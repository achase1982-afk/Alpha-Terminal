import { desc, sql } from "drizzle-orm";
import { pgTable, text, serial, real, integer, boolean, timestamp, jsonb, uniqueIndex, index, date, doublePrecision, bigint, numeric, primaryKey, uuid, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tradeJournalTable = pgTable("trade_journal", {
  id: serial("id").primaryKey(),
  schwabOrderId: text("schwab_order_id"),
  symbol: text("symbol").notNull(),
  strategyType: text("strategy_type"),
  direction: text("direction"),
  pulseComposite: real("pulse_composite"),
  pulseConfidence: real("pulse_confidence"),
  pulseBias: text("pulse_bias"),
  scannerScore: real("scanner_score"),
  tradingMode: integer("trading_mode"),
  tradingModeLabel: text("trading_mode_label"),
  eventConflicts: jsonb("event_conflicts"),
  ivr: real("ivr"),
  entryPrice: real("entry_price"),
  isCredit: boolean("is_credit"),
  maxLoss: real("max_loss"),
  maxGain: real("max_gain"),
  thesis: text("thesis"),
  legs: jsonb("legs"),
  quantity: integer("quantity"),
  accountHash: text("account_hash"),
  exitPrice: real("exit_price"),
  realizedPL: real("realized_pl"),
  resultNote: text("result_note"),
  followedPlan: boolean("followed_plan"),
  resultLoggedAt: timestamp("result_logged_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertTradeJournalSchema = createInsertSchema(tradeJournalTable).omit({ id: true });
export type InsertTradeJournal = z.infer<typeof insertTradeJournalSchema>;
export type TradeJournal = typeof tradeJournalTable.$inferSelect;

export const stagedExitsTable = pgTable("staged_exits", {
  id: serial("id").primaryKey(),
  journalEntryId: integer("journal_entry_id"),
  schwabEntryOrderId: text("schwab_entry_order_id"),
  schwabExitOrderId: text("schwab_exit_order_id"),
  symbol: text("symbol").notNull(),
  exitType: text("exit_type").notNull(),
  targetPrice: real("target_price"),
  entryCredit: real("entry_credit"),
  strategyType: text("strategy_type"),
  dte: integer("dte"),
  entryTimestamp: timestamp("entry_timestamp"),
  stopAlertSent: boolean("stop_alert_sent").default(false),
  timeAlert50Sent: boolean("time_alert_50_sent").default(false),
  timeAlert75Sent: boolean("time_alert_75_sent").default(false),
  expirationAlertSent: boolean("expiration_alert_sent").default(false),
  status: text("status").default("ACTIVE"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertStagedExitSchema = createInsertSchema(stagedExitsTable).omit({ id: true });
export type InsertStagedExit = z.infer<typeof insertStagedExitSchema>;
export type StagedExit = typeof stagedExitsTable.$inferSelect;

export const failureLogTable = pgTable("failure_log", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  system: text("system").notNull(),
  severity: text("severity").notNull(),
  message: text("message").notNull(),
  details: jsonb("details"),
  resolved: boolean("resolved").default(false).notNull(),
  resolvedAt: timestamp("resolved_at"),
});

export type FailureLog = typeof failureLogTable.$inferSelect;

export const scannerWatchlistsTable = pgTable("scanner_watchlists", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  symbols: jsonb("symbols").$type<string[]>().notNull().default([]),
  isProtected: boolean("is_protected").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ScannerWatchlist = typeof scannerWatchlistsTable.$inferSelect;

export const scannerScreensTable = pgTable("scanner_screens", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  filters: jsonb("filters").$type<{
    marketCapMin?: number;
    marketCapMax?: number;
    volumeMin?: number;
    priceMin?: number;
    priceMax?: number;
    sectors?: string[];
    sectorsExclude?: string[];
    exchange?: string;
    optionsVolumeMin?: number;
    country?: string;
    maxResults?: number;
  }>().notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  cachedSymbols: jsonb("cached_symbols").$type<string[]>(),
  cachedAt: timestamp("cached_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ScannerScreen = typeof scannerScreensTable.$inferSelect;

export const polygonOptionsHistoryTable = pgTable("polygon_options_history", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  optionSymbol: text("option_symbol").notNull(),
  tradeDate: text("trade_date").notNull(),
  volume: integer("volume").default(0),
  openInterest: integer("open_interest"),
  closePrice: real("close_price"),
  vwap: real("vwap"),
  strike: real("strike"),
  expiry: text("expiry"),
  putCall: text("put_call"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("pol_opt_unique").on(t.optionSymbol, t.tradeDate),
  // Trailing-baseline queries hit this table by ticker over a date range.
  // Without this composite index, queries seq-scan ~1.7M rows per ticker
  // (~280ms each → 37s per 130-ticker scan). With index, expected sub-50ms total.
  index("pol_opt_ticker_date_idx").on(t.ticker, t.tradeDate),
]);

export type PolygonOptionsHistory = typeof polygonOptionsHistoryTable.$inferSelect;

export const polygonSyncLogTable = pgTable("polygon_sync_log", {
  id: serial("id").primaryKey(),
  tradeDate: text("trade_date").notNull().unique(),
  status: text("status").notNull().default("pending"),
  rowsInserted: integer("rows_inserted").default(0),
  tickers: jsonb("tickers").$type<string[]>(),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
  errorMsg: text("error_msg"),
});

export type PolygonSyncLog = typeof polygonSyncLogTable.$inferSelect;

export const equityDailyTable = pgTable("equity_daily", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  date: date("date").notNull(),
  open: real("open"),
  high: real("high"),
  low: real("low"),
  close: real("close").notNull(),
  adjustedClose: real("adjusted_close"),
  volume: bigint("volume", { mode: "number" }),
  marketCap: bigint("market_cap", { mode: "number" }),
  haltStatus: boolean("halt_status").default(false),
  ivr: real("ivr"),
  iv30d: real("iv_30d"),
  iv30dProxy: real("iv_30d_proxy"),
  ivrSource: text("ivr_source"),
  hv20d: real("hv_20d"),
  hv30d: real("hv_30d"),
  hv60d: real("hv_60d"),
  putCallRatio: real("put_call_ratio"),
  sma20: real("sma_20"),
  atr5: real("atr_5"),
  atr20: real("atr_20"),
  medianVolume5d: bigint("median_volume_5d", { mode: "number" }),
  medianVolume20d: bigint("median_volume_20d", { mode: "number" }),
  obv: bigint("obv", { mode: "number" }),
  rsRatio: real("rs_ratio"),
  priceChangePct5d: real("price_change_pct_5d"),
  priceChangePct10d: real("price_change_pct_10d"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("eq_daily_sym_date").on(t.symbol, t.date),
]);

export type EquityDaily = typeof equityDailyTable.$inferSelect;

export const optionsChainDailyTable = pgTable("options_chain_daily", {
  id: serial("id").primaryKey(),
  underlyingSymbol: text("underlying_symbol").notNull(),
  date: date("date").notNull(),
  optionSymbol: text("option_symbol"),
  optionType: text("option_type").notNull(),
  strike: real("strike").notNull(),
  expiration: date("expiration").notNull(),
  dte: integer("dte"),
  bid: real("bid"),
  ask: real("ask"),
  mid: real("mid"),
  last: real("last"),
  volume: integer("volume"),
  openInterest: integer("open_interest"),
  impliedVolatility: real("implied_volatility"),
  delta: real("delta"),
  gamma: real("gamma"),
  theta: real("theta"),
  vega: real("vega"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("opt_chain_unique").on(t.underlyingSymbol, t.date, t.optionType, t.strike, t.expiration),
]);

export type OptionsChainDaily = typeof optionsChainDailyTable.$inferSelect;

/** Per-symbol per-session-date Schwab options chain ingest outcomes (range=ALL vs bracketed fallback). */
export const schwabChainIngestMetricsTable = pgTable("schwab_chain_ingest_metrics", {
  underlyingSymbol: text("underlying_symbol").notNull(),
  sessionDate: date("session_date").notNull(),
  rangeAllStatus: text("range_all_status").notNull(),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }).notNull(),
  lastFailureReason: text("last_failure_reason"),
  rangeAllFailuresTotal: integer("range_all_failures_total").notNull().default(0),
  bracketedFallbackSuccessTotal: integer("bracketed_fallback_success_total").notNull().default(0),
  totalFailureTotal: integer("total_failure_total").notNull().default(0),
}, (t) => [
  uniqueIndex("schwab_chain_ingest_metrics_sym_date").on(t.underlyingSymbol, t.sessionDate),
]);

export type SchwabChainIngestMetric = typeof schwabChainIngestMetricsTable.$inferSelect;

export const optionsFlowPerStrikeTable = pgTable("options_flow_per_strike", {
  id: serial("id").primaryKey(),
  underlyingSymbol: text("underlying_symbol").notNull(),
  date: date("date").notNull(),
  optionType: text("option_type").notNull(),
  strike: real("strike").notNull(),
  expiration: date("expiration").notNull(),
  dte: integer("dte"),
  dailyVolume: integer("daily_volume"),
  openInterest: integer("open_interest"),
  bid: real("bid"),
  ask: real("ask"),
  mid: real("mid"),
  impliedVolatility: real("implied_volatility"),
  delta: real("delta"),
  gamma: real("gamma"),
  theta: real("theta"),
  vega: real("vega"),
  avgTradePrice: real("avg_trade_price"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("flow_strike_unique").on(t.underlyingSymbol, t.date, t.optionType, t.strike, t.expiration),
]);

export type OptionsFlowPerStrike = typeof optionsFlowPerStrikeTable.$inferSelect;

export const optionsFlowRawTradesTable = pgTable("options_flow_raw_trades", {
  id: serial("id").primaryKey(),
  underlyingSymbol: text("underlying_symbol").notNull(),
  date: date("date").notNull(),
  timestamp: timestamp("timestamp"),
  optionSymbol: text("option_symbol"),
  optionType: text("option_type").notNull(),
  strike: real("strike").notNull(),
  expiration: date("expiration").notNull(),
  tradePrice: real("trade_price"),
  size: integer("size"),
  notional: doublePrecision("notional"),
  side: text("side"),
  isBlock: boolean("is_block").default(false),
  isSweep: boolean("is_sweep").default(false),
  /** Dedup key for REST backfill vs live watcher (partial unique index when set). */
  sourceTradeId: text("source_trade_id"),
  /** Polygon OPRA exchange id on the trade (Item 12/13). */
  exchangeId: integer("exchange_id"),
  /** Derived: on_exchange | trf | unknown (static MIC map in app). */
  venueClass: text("venue_class"),
  /** Calendar days to expiration at trade time (Item 8). */
  dteDays: integer("dte_days"),
  /** Session bucket: open_auction | mid_session | close_auction | unknown (Item 11). */
  sessionPhase: text("session_phase"),
  /** Volume / open interest at classify time when available (Item 7). */
  volOiRatio: real("vol_oi_ratio"),
  openInterestSnapshot: integer("open_interest_snapshot"),
  /** vs 20d rolling avg contracts for this strike key; null if no baseline (Items 3/5/25). */
  volumeVsBaseline20d: real("volume_vs_baseline_20d"),
  /** Market cap USD snapshot for tiered thresholds (Items 2/4/6). */
  marketCapUsd: doublePrecision("market_cap_usd"),
  /** Tier label at write: mega | large | mid | small | micro | etf_index | etf_sector | etf_niche | unknown */
  marketCapTier: text("market_cap_tier"),
  /** USD threshold used for large-notional gate at write (Item 4). */
  notionalThresholdUsd: doublePrecision("notional_threshold_usd"),
  /** ask | bid | mid | null + confidence (Item 15). */
  aggressorConfidence: text("aggressor_confidence"),
  /** Multi-leg Layer 1 synthetic group (Item 10); filled by post-batch job. */
  syntheticLegGroupId: text("synthetic_leg_group_id"),
  multiLegConfidence: text("multi_leg_confidence"),
  /** Low-cardinality flags: repeat_ask_cluster, etc. (JSON object, Item 9). */
  extras: jsonb("extras"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("options_flow_raw_trades_source_dedup_idx")
    .on(t.underlyingSymbol, t.date, t.sourceTradeId)
    .where(sql`${t.sourceTradeId} IS NOT NULL`),
  index("options_flow_raw_trades_sym_date_ts_idx").on(t.underlyingSymbol, t.date, t.timestamp),
  index("options_flow_raw_trades_leg_group_idx").on(t.syntheticLegGroupId),
]);

export type OptionsFlowRawTrade = typeof optionsFlowRawTradesTable.$inferSelect;

export const optionsTapeBackfillOccCacheTable = pgTable("options_tape_backfill_occ_cache", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  sessionDate: date("session_date").notNull(),
  occ: text("occ").notNull(),
  lastCoverageEndNs: bigint("last_coverage_end_ns", { mode: "bigint" }).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("options_tape_backfill_occ_cache_unique").on(t.ticker, t.sessionDate, t.occ),
  index("options_tape_backfill_occ_cache_ticker_date_idx").on(t.ticker, t.sessionDate),
]);

export type OptionsTapeBackfillOccCache = typeof optionsTapeBackfillOccCacheTable.$inferSelect;

/** Latest OCC/trade coverage snapshot when strategist tape backfill runs (scanner graduated tiers). */
export const scannerTapeMetricsTable = pgTable("scanner_tape_metrics", {
  ticker: text("ticker").notNull(),
  sessionDate: date("session_date").notNull(),
  occRequested: integer("occ_requested").notNull().default(0),
  occCompleted: integer("occ_completed").notNull().default(0),
  tradesAttemptedInsert: integer("trades_attempted_insert").notNull().default(0),
  tradesInsertedCommitted: integer("trades_inserted_committed").notNull().default(0),
  /** Raw trades returned from Polygon in session window (tape backfill phase 1 sum over OCC). */
  tradesObservedPolygon: integer("trades_observed_polygon"),
  dedupeDropped: integer("dedupe_dropped").notNull().default(0),
  anyTruncated: boolean("any_truncated").notNull().default(false),
  status: text("status").notNull(),
  /** Wall-clock ms for the last strategistTapeBackfill run (this ticker/session). */
  durationMs: integer("duration_ms"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.ticker, t.sessionDate] }),
  index("scanner_tape_metrics_ticker_updated_idx").on(t.ticker, t.updatedAt),
]);

export type ScannerTapeMetric = typeof scannerTapeMetricsTable.$inferSelect;

/** Historical tape backfill runs (append-only) for coverage trending vs scanner_health cycles. */
export const scannerTapeMetricsCycleLogTable = pgTable("scanner_tape_metrics_cycle_log", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  sessionDate: date("session_date").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
  chainContractCount: integer("chain_contract_count"),
  occRequested: integer("occ_requested").notNull().default(0),
  occCompleted: integer("occ_completed").notNull().default(0),
  tradesAttemptedInsert: integer("trades_attempted_insert").notNull().default(0),
  tradesInsertedCommitted: integer("trades_inserted_committed").notNull().default(0),
  dedupeDropped: integer("dedupe_dropped").notNull().default(0),
  anyTruncated: boolean("any_truncated").notNull().default(false),
  status: text("status").notNull(),
  durationMs: integer("duration_ms"),
  polygonHttpTimeoutMs: integer("polygon_http_timeout_ms"),
  symbolBudgetMs: integer("symbol_budget_ms"),
}, (t) => [
  index("scanner_tape_cycle_log_ticker_recorded_idx").on(t.ticker, t.recordedAt),
  index("scanner_tape_cycle_log_recorded_idx").on(t.recordedAt),
]);

export type ScannerTapeMetricsCycleLog = typeof scannerTapeMetricsCycleLogTable.$inferSelect;

/**
 * Item 3: materialized per-OCC 20d avg volume as-of a session calendar date.
 * Populated by tape backfill / nightly job; used for re-classification (Item 24).
 */
export const optionsFlowStrikeBaselineDailyTable = pgTable("options_flow_strike_baseline_daily", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  optionSymbol: text("option_symbol").notNull(),
  baselineDate: date("baseline_date").notNull(),
  avgVolume20d: doublePrecision("avg_volume_20d").notNull(),
  daysObserved: integer("days_observed").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("options_flow_strike_baseline_daily_uniq").on(t.optionSymbol, t.baselineDate),
  index("options_flow_strike_baseline_daily_ticker_date_idx").on(t.ticker, t.baselineDate),
]);

export type OptionsFlowStrikeBaselineDaily = typeof optionsFlowStrikeBaselineDailyTable.$inferSelect;

// Per-strike rollup of classified live execution events. Populated by
// the rollup job from options_flow_raw_trades. Same composite key as
// options_flow_per_strike so the scanner can left-join on read.
export const optionsFlowExecPerStrikeTable = pgTable("options_flow_exec_per_strike", {
  id: serial("id").primaryKey(),
  underlyingSymbol: text("underlying_symbol").notNull(),
  date: date("date").notNull(),
  optionType: text("option_type").notNull(),
  strike: real("strike").notNull(),
  expiration: date("expiration").notNull(),
  sweepCount: integer("sweep_count").default(0).notNull(),
  blockCount: integer("block_count").default(0).notNull(),
  regularCount: integer("regular_count").default(0).notNull(),
  sweepNotional: doublePrecision("sweep_notional").default(0).notNull(),
  blockNotional: doublePrecision("block_notional").default(0).notNull(),
  regularNotional: doublePrecision("regular_notional").default(0).notNull(),
  sweepVolume: integer("sweep_volume").default(0).notNull(),
  blockVolume: integer("block_volume").default(0).notNull(),
  regularVolume: integer("regular_volume").default(0).notNull(),
  lastEventTs: timestamp("last_event_ts"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("flow_exec_strike_unique").on(t.underlyingSymbol, t.date, t.optionType, t.strike, t.expiration),
  index("flow_exec_sym_date").on(t.underlyingSymbol, t.date),
]);

export type OptionsFlowExecPerStrike = typeof optionsFlowExecPerStrikeTable.$inferSelect;

export const flowDailyAggregatesTable = pgTable("flow_daily_aggregates", {
  id: serial("id").primaryKey(),
  underlyingSymbol: text("underlying_symbol").notNull(),
  date: date("date").notNull(),
  totalCallVolume: integer("total_call_volume"),
  totalPutVolume: integer("total_put_volume"),
  totalOi: integer("total_oi"),
  totalOptionsNotional: doublePrecision("total_options_notional"),
  avgVolOiRatio: real("avg_vol_oi_ratio"),
  pcSkew: real("pc_skew"),
  blockCount: integer("block_count"),
  blockNotionalTotal: doublePrecision("block_notional_total"),
  avgDailyOptionsNotional20d: doublePrecision("avg_daily_options_notional_20d"),
  flowDirection: text("flow_direction"),
  numSweeps: integer("num_sweeps"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("flow_agg_unique").on(t.underlyingSymbol, t.date),
]);

export type FlowDailyAggregate = typeof flowDailyAggregatesTable.$inferSelect;

export const referenceDataTable = pgTable("reference_data", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull().unique(),
  sectorEtf: text("sector_etf"),
  isAdr: boolean("is_adr").default(false),
  ipoDate: date("ipo_date"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type ReferenceData = typeof referenceDataTable.$inferSelect;

export const corporateEventsTable = pgTable("corporate_events", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  earningsDate: date("earnings_date"),
  earningsTiming: text("earnings_timing"),
  /** Raw FMP `time` field before BMO/AMC normalization in app code. */
  earningsTimeRaw: text("earnings_time_raw"),
  /** Forward estimates from FMP earnings calendar backfill (when present). */
  earningsEpsEstimate: doublePrecision("earnings_eps_estimate"),
  earningsRevenueEstimate: doublePrecision("earnings_revenue_estimate"),
  earningsEpsActual: doublePrecision("earnings_eps_actual"),
  earningsRevenueActual: doublePrecision("earnings_revenue_actual"),
  splitDate: date("split_date"),
  splitRatio: text("split_ratio"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("corp_events_sym_date").on(t.symbol, t.earningsDate),
]);

export type CorporateEvent = typeof corporateEventsTable.$inferSelect;

export const analystPriceTargetsTable = pgTable("analyst_price_targets", {
  ticker: text("ticker").primaryKey().notNull(),
  targetHigh: numeric("target_high"),
  targetLow: numeric("target_low"),
  targetMedian: numeric("target_median"),
  targetConsensus: numeric("target_consensus"),
  numAnalysts: integer("num_analysts"),
  asOfDate: date("as_of_date"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type AnalystPriceTargetRow = typeof analystPriceTargetsTable.$inferSelect;

export const analystGradesTable = pgTable("analyst_grades", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  actionDate: date("action_date").notNull(),
  action: text("action").notNull(),
  gradingCompany: text("grading_company"),
  previousGrade: text("previous_grade"),
  newGrade: text("new_grade"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("analyst_grades_ticker_action_unique").on(
    t.ticker,
    t.actionDate,
    t.gradingCompany,
    t.action,
  ),
  index("idx_ag_ticker_date").on(t.ticker, t.actionDate),
]);

export type AnalystGradeRow = typeof analystGradesTable.$inferSelect;

export const earningsSurprisesHistoryTable = pgTable("earnings_surprises_history", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  reportDate: date("report_date").notNull(),
  epsEstimate: numeric("eps_estimate"),
  epsActual: numeric("eps_actual"),
  surprisePct: numeric("surprise_pct"),
  revenueEstimate: numeric("revenue_estimate"),
  revenueActual: numeric("revenue_actual"),
  revenueSurprisePct: numeric("revenue_surprise_pct"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("earnings_surprises_history_ticker_report_unique").on(t.ticker, t.reportDate),
  index("idx_esh_ticker_date").on(t.ticker, t.reportDate),
]);

export type EarningsSurpriseHistoryRow = typeof earningsSurprisesHistoryTable.$inferSelect;

/** FMP analyst consensus ranges by fiscal period end (quarterly rows). */
export const analystEstimatesTable = pgTable("analyst_estimates", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  fiscalPeriodEnd: date("fiscal_period_end").notNull(),
  epsAvg: numeric("eps_avg"),
  epsHigh: numeric("eps_high"),
  epsLow: numeric("eps_low"),
  revenueAvg: numeric("revenue_avg"),
  revenueHigh: numeric("revenue_high"),
  revenueLow: numeric("revenue_low"),
  analystCountEps: integer("analyst_count_eps"),
  analystCountRevenue: integer("analyst_count_revenue"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("analyst_estimates_ticker_period_unique").on(t.ticker, t.fiscalPeriodEnd),
  index("idx_analyst_estimates_ticker_period").on(t.ticker, t.fiscalPeriodEnd),
]);

export type AnalystEstimateRow = typeof analystEstimatesTable.$inferSelect;

export const macroCalendarTable = pgTable("macro_calendar", {
  id: serial("id").primaryKey(),
  eventDate: date("event_date").notNull(),
  eventTime: text("event_time"),
  country: text("country").notNull(),
  event: text("event").notNull(),
  impact: text("impact"),
  actual: numeric("actual"),
  previous: numeric("previous"),
  estimate: numeric("estimate"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("macro_calendar_date_country_event_unique").on(t.eventDate, t.country, t.event),
  index("idx_macro_calendar_event_date").on(t.eventDate),
]);

export type MacroCalendarRow = typeof macroCalendarTable.$inferSelect;

export const aiLabIdeasTable = pgTable("ai_lab_ideas", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  originType: text("origin_type").notNull().default("AI_LAB"),
  analystModelName: text("analyst_model_name").notNull().default("claude-sonnet"),
  criticModelName: text("critic_model_name"),

  symbol: text("symbol").notNull(),
  direction: text("direction").notNull(),
  instrumentType: text("instrument_type").notNull(),

  optionStructureType: text("option_structure_type"),
  legs: jsonb("legs"),

  entryZone: jsonb("entry_zone"),
  softStop: doublePrecision("soft_stop"),
  targetZone: jsonb("target_zone"),
  timeHorizon: text("time_horizon").notNull().default("3-10D"),

  thesis: text("thesis").notNull(),
  catalyst: text("catalyst").notNull(),
  invalidation: text("invalidation").notNull(),
  regimeFit: text("regime_fit").notNull().default("NEUTRAL"),
  mainSignals: jsonb("main_signals"),
  scannerAlignmentAtCreation: jsonb("scanner_alignment_at_creation"),

  signalStrength: integer("signal_strength").notNull().default(50),
  convictionLevel: text("conviction_level").notNull().default("MEDIUM"),
  uncertainty: jsonb("uncertainty"),

  entrySpreadPct: doublePrecision("entry_spread_pct"),
  oiAtEntry: integer("oi_at_entry"),
  volumeAtEntry: integer("volume_at_entry"),
  volumeToOiRatio: doublePrecision("volume_to_oi_ratio"),

  regimeAtCreation: text("regime_at_creation"),

  analystNote: text("analyst_note"),
  criticNote: text("critic_note"),

  primaryProposal: jsonb("primary_proposal"),
  skepticCritique: jsonb("skeptic_critique"),
  finalDecision: jsonb("final_decision"),

  status: text("status").notNull().default("NEW"),
  invalidatedReason: text("invalidated_reason"),
  closedAt: timestamp("closed_at"),

  sector: text("sector"),
}, (t) => [
  uniqueIndex("ai_lab_ideas_sym_status").on(t.symbol, t.status),
]);

export const aiLabDeliberationsTable = pgTable("ai_lab_deliberations", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  symbol: text("symbol").notNull(),
  source: text("source").notNull(),
  analystModelName: text("analyst_model_name"),
  criticModelName: text("critic_model_name"),
  inputSnapshot: jsonb("input_snapshot"),
  primaryProposal: jsonb("primary_proposal"),
  skepticCritique: jsonb("skeptic_critique"),
  finalDecision: jsonb("final_decision"),
  ideaId: integer("idea_id"),
  conversationLog: jsonb("conversation_log"),
});

export type AiLabDeliberation = typeof aiLabDeliberationsTable.$inferSelect;
export type AiLabDeliberationInsert = typeof aiLabDeliberationsTable.$inferInsert;

export type AiLabIdea = typeof aiLabIdeasTable.$inferSelect;
export type AiLabIdeaInsert = typeof aiLabIdeasTable.$inferInsert;

export const aiLabIdeaOutcomesTable = pgTable("ai_lab_idea_outcomes", {
  id: serial("id").primaryKey(),
  ideaId: integer("idea_id").notNull(),
  evaluatedAt: timestamp("evaluated_at").defaultNow().notNull(),

  entryPrice: doublePrecision("entry_price"),
  exitPrice: doublePrecision("exit_price"),
  maxFavorableExcursion: doublePrecision("max_favorable_excursion"),
  maxAdverseExcursion: doublePrecision("max_adverse_excursion"),
  pnlPct: doublePrecision("pnl_pct"),
  pnlMultiple: doublePrecision("pnl_multiple"),
  hitTarget: boolean("hit_target"),
  hitStop: boolean("hit_stop"),
  wentNowhere: boolean("went_nowhere"),
  evaluationCompletedAt: timestamp("evaluation_completed_at"),
  regimeAtExit: text("regime_at_exit"),
  notes: text("notes"),
});

export type AiLabIdeaOutcome = typeof aiLabIdeaOutcomesTable.$inferSelect;

export const aiLabEmbeddingsTable = pgTable("ai_lab_embeddings", {
  id: serial("id").primaryKey(),
  ideaId: integer("idea_id").notNull(),
  embedding: jsonb("embedding"),
  tags: jsonb("tags"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AiLabEmbedding = typeof aiLabEmbeddingsTable.$inferSelect;

export const aiLabWatchlistTable = pgTable("ai_lab_watchlist", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  anomalyTypes: jsonb("anomaly_types"),
  anomalyScores: jsonb("anomaly_scores"),
  compositeScore: integer("composite_score").notNull().default(0),
  passName: text("pass_name").notNull().default("OVERNIGHT_DIGEST"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"),
}, (t) => [
  uniqueIndex("ai_lab_wl_sym_pass").on(t.symbol, t.passName),
]);

export type AiLabWatchlistEntry = typeof aiLabWatchlistTable.$inferSelect;

export const snapshotCollectionLogTable = pgTable("snapshot_collection_log", {
  id: serial("id").primaryKey(),
  date: date("date").notNull().unique(),
  status: text("status").notNull().default("pending"),
  equityRows: integer("equity_rows").default(0),
  chainRows: integer("chain_rows").default(0),
  flowRows: integer("flow_rows").default(0),
  aggregateRows: integer("aggregate_rows").default(0),
  errorMsg: text("error_msg"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export const trackedTickersTable = pgTable("tracked_tickers", {
  symbol: text("symbol").primaryKey(),
  source: text("source").notNull().default("strategist_on_demand"),
  active: boolean("active").default(true).notNull(),
  firstRequestedAt: timestamp("first_requested_at").defaultNow().notNull(),
  lastRequestedAt: timestamp("last_requested_at").defaultNow().notNull(),
  lastSnapshotAt: timestamp("last_snapshot_at"),
  lastIvrBackfillJobId: text("last_ivr_backfill_job_id"),
  notes: text("notes"),
  errorMsg: text("error_msg"),
});

export type TrackedTicker = typeof trackedTickersTable.$inferSelect;
export type TrackedTickerInsert = typeof trackedTickersTable.$inferInsert;

export const ivrBackfillJobsTable = pgTable("ivr_backfill_jobs", {
  id: text("id").primaryKey(),
  symbol: text("symbol").notNull(),
  /** ondemand_ivr | admin_iv_history | admin_hv_proxy */
  jobKind: text("job_kind").notNull().default("ondemand_ivr"),
  payload: jsonb("payload").$type<Record<string, unknown> | null>(),
  status: text("status").notNull().default("queued"),
  source: text("source").notNull().default("none"),
  daysRequested: integer("days_requested").notNull().default(252),
  daysLoaded: integer("days_loaded").notNull().default(0),
  equityRowsWritten: integer("equity_rows_written").notNull().default(0),
  ivRowsWritten: integer("iv_rows_written").notNull().default(0),
  ivrRowsWritten: integer("ivr_rows_written").notNull().default(0),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  errorMsg: text("error_msg"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("ivr_backfill_jobs_symbol_status_idx").on(t.symbol, t.status),
]);

export type IvrBackfillJob = typeof ivrBackfillJobsTable.$inferSelect;
export type IvrBackfillJobInsert = typeof ivrBackfillJobsTable.$inferInsert;

export const aiLabConfigTable = pgTable("ai_lab_config", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type AiLabConfigRow = typeof aiLabConfigTable.$inferSelect;

export const strategistSettingsTable = pgTable("strategist_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: doublePrecision("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type StrategistSetting = typeof strategistSettingsTable.$inferSelect;

export const strategistTelemetryTable = pgTable("strategist_telemetry", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  ticker: text("ticker").notNull(),
  result: text("result").notNull(),
  regime: jsonb("regime"),
  tickerData: jsonb("ticker_data"),
  idioScore: jsonb("idio_score"),
  toxicGate: jsonb("toxic_gate"),
  viability: jsonb("viability"),
  earningsGate: jsonb("earnings_gate"),
  strategyDecision: jsonb("strategy_decision"),
  candidatesGenerated: integer("candidates_generated"),
  candidatesFiltered: integer("candidates_filtered"),
  filterReasons: jsonb("filter_reasons"),
  winningCandidate: jsonb("winning_candidate"),
  edgeAttribution: jsonb("edge_attribution"),
  recommendationThesis: text("recommendation_thesis"),
  dataPackage: jsonb("data_package"),
  rawAiResponse: text("raw_ai_response"),
  confidenceBase: real("confidence_base"),
  confidenceCatalystDelta: real("confidence_catalyst_delta"),
  confidenceFinal: real("confidence_final"),
  catalystAlignment: text("catalyst_alignment"),
  dataSource: text("data_source"),
  fetchFailureMode: text("fetch_failure_mode"),
  fullDiagnostic: jsonb("full_diagnostic"),
  scannerSource: text("scanner_source"),
  scannerScore: integer("scanner_score"),
  scannerMode: text("scanner_mode"),
  scannerEdgeType: text("scanner_edge_type"),
  scannerDirectionalLean: text("scanner_directional_lean"),
  scannerSurfacedBy: text("scanner_surfaced_by"),
  scannerFlowScore: integer("scanner_flow_score"),
  scannerUniverse: text("scanner_universe"),
  /** LLM vendor for Conviction Desk audit rows: anthropic | openai | gemini. */
  provider: text("provider"),
  /** Conviction Desk: assembled user messages / full prompt text sent to the model. */
  modelInput: text("model_input"),
  systemPrompt: text("system_prompt"),
  toolsAttached: jsonb("tools_attached"),
  /** Provider-native reasoning / thinking configuration snapshot (JSON). */
  thinkingConfig: jsonb("thinking_config"),
  rawApiResponse: jsonb("raw_api_response"),
  thinkingBlocks: text("thinking_blocks"),
  webSearchQueries: jsonb("web_search_queries"),
  webSearchResults: jsonb("web_search_results"),
  /** Provider response id when available (OpenAI `response.id`, Anthropic message id, etc.). */
  providerRequestId: text("provider_request_id"),
  modelName: text("model_name"),
});

export type StrategistTelemetry = typeof strategistTelemetryTable.$inferSelect;

/** NYSE closing auction imbalance snapshots from IBKR generic tick 225 (API stream). */
export const nyseOrderImbalancesTable = pgTable(
  "nyse_order_imbalances",
  {
    id: text("id").primaryKey(),
    underlyingSymbol: text("underlying_symbol").notNull(),
    imbalanceTimestamp: timestamp("imbalance_timestamp", { withTimezone: true }).notNull(),
    imbalanceShares: bigint("imbalance_shares", { mode: "bigint" }).notNull(),
    imbalanceNotionalUsd: doublePrecision("imbalance_notional_usd").notNull(),
    indicativePrice: doublePrecision("indicative_price").notNull(),
    pairedShares: bigint("paired_shares", { mode: "bigint" }),
    regulatoryImbalance: bigint("regulatory_imbalance", { mode: "bigint" }),
    auctionType: text("auction_type").notNull().default("closing"),
    source: text("source").notNull().default("IBKR_NYSE"),
  },
  (t) => [
    index("nyse_order_imbalances_sym_ts_idx").on(t.underlyingSymbol, t.imbalanceTimestamp),
    index("nyse_order_imbalances_ts_idx").on(t.imbalanceTimestamp),
  ],
);

export type NyseOrderImbalance = typeof nyseOrderImbalancesTable.$inferSelect;
export type NyseOrderImbalanceInsert = typeof nyseOrderImbalancesTable.$inferInsert;

/** NASDAQ TotalView L2 depth summary (deterministic microstructure for strategist). */
export const nasdaqTotalviewSummaryTable = pgTable(
  "nasdaq_totalview_summary",
  {
    id: text("id").primaryKey(),
    underlyingSymbol: text("underlying_symbol").notNull(),
    summaryTimestamp: timestamp("summary_timestamp", { withTimezone: true }).notNull(),
    spotMid: doublePrecision("spot_mid").notNull(),
    bidDepth5pct: doublePrecision("bid_depth_5pct").notNull(),
    askDepth5pct: doublePrecision("ask_depth_5pct").notNull(),
    bidDepth1pct: doublePrecision("bid_depth_1pct").notNull(),
    askDepth1pct: doublePrecision("ask_depth_1pct").notNull(),
    bookImbalanceRatio: doublePrecision("book_imbalance_ratio").notNull(),
    topBidSize: doublePrecision("top_bid_size").notNull(),
    topAskSize: doublePrecision("top_ask_size").notNull(),
    source: text("source").notNull().default("IBKR_NASDAQ"),
  },
  (t) => [
    index("nasdaq_totalview_summary_sym_ts_idx").on(t.underlyingSymbol, t.summaryTimestamp),
    index("nasdaq_totalview_summary_ts_idx").on(t.summaryTimestamp),
  ],
);

export type NasdaqTotalviewSummary = typeof nasdaqTotalviewSummaryTable.$inferSelect;

/** ES front-month CME depth summary (macro book context). */
export const cmeEsDepthSummaryTable = pgTable(
  "cme_es_depth_summary",
  {
    id: text("id").primaryKey(),
    underlyingSymbol: text("underlying_symbol").notNull().default("ES"),
    contractMonth: text("contract_month").notNull(),
    summaryTimestamp: timestamp("summary_timestamp", { withTimezone: true }).notNull(),
    midPrice: doublePrecision("mid_price").notNull(),
    bidDepth5ticks: doublePrecision("bid_depth_5ticks").notNull(),
    askDepth5ticks: doublePrecision("ask_depth_5ticks").notNull(),
    bidDepth1tick: doublePrecision("bid_depth_1tick").notNull(),
    askDepth1tick: doublePrecision("ask_depth_1tick").notNull(),
    bookImbalanceRatio: doublePrecision("book_imbalance_ratio").notNull(),
    topBidSize: doublePrecision("top_bid_size").notNull(),
    topAskSize: doublePrecision("top_ask_size").notNull(),
    source: text("source").notNull().default("IBKR_CME"),
  },
  (t) => [
    index("cme_es_depth_summary_ts_idx").on(t.summaryTimestamp),
  ],
);

export type CmeEsDepthSummary = typeof cmeEsDepthSummaryTable.$inferSelect;

export const strategistHistoryTable = pgTable("strategist_history", {
  id: serial("id").primaryKey(),
  jobId: text("job_id").notNull().unique(),
  ticker: text("ticker").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  cardJson: jsonb("card_json").notNull(),
  cleared: boolean("cleared").default(false).notNull(),
  clearedAt: timestamp("cleared_at"),
});

export type StrategistHistory = typeof strategistHistoryTable.$inferSelect;

/** Strategist V3 durable job queue (see docs/strategist-v3-architecture.md). */
export const strategistJobStatusEnum = pgEnum("strategist_job_status", [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const strategistJobKindEnum = pgEnum("strategist_job_kind", [
  "analyze",
  "validate_trade",
]);

export type StrategistJobStatus = (typeof strategistJobStatusEnum.enumValues)[number];
export type StrategistJobKind = (typeof strategistJobKindEnum.enumValues)[number];

export type StrategistJobPhase =
  | "preparing_iv"
  | "analyzing"
  | "debating"
  | "validating"
  | "persisting";

export type StrategistJobError = {
  code: string;
  message: string;
  detail?: unknown;
};

export const strategistJobsTable = pgTable(
  "strategist_jobs",
  {
    /** Client-supplied jobId; same string as strategist_history.job_id. */
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    kind: strategistJobKindEnum("kind").notNull(),
    ticker: text("ticker").notNull(),
    params: jsonb("params").notNull().$type<Record<string, unknown>>(),
    status: strategistJobStatusEnum("status").notNull().default("queued"),
    phase: text("phase"),
    lastCompletedPhase: text("last_completed_phase"),
    progress: jsonb("progress").notNull().default({}).$type<Record<string, unknown>>(),
    checkpoint: jsonb("checkpoint").notNull().default({}).$type<Record<string, unknown>>(),
    resultHistoryId: integer("result_history_id"),
    error: jsonb("error").$type<StrategistJobError | null>(),
    priority: integer("priority").notNull().default(0),
    attempt: integer("attempt").notNull().default(0),
    workerId: text("worker_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_strategist_jobs_queue")
      .on(t.status, t.priority, t.createdAt)
      .where(sql`${t.status} = 'queued'`),
    index("idx_strategist_jobs_dedup")
      .on(t.userId, t.kind, t.ticker)
      .where(sql`${t.status} in ('queued', 'running')`),
    index("idx_strategist_jobs_user_recent").on(t.userId, t.createdAt),
    index("idx_strategist_jobs_heartbeat")
      .on(t.lastHeartbeatAt)
      .where(sql`${t.status} = 'running'`),
    index("idx_strategist_jobs_resumable")
      .on(t.status, t.lastCompletedPhase)
      .where(sql`${t.status} = 'running' and ${t.lastCompletedPhase} is not null`),
  ],
);

export type StrategistJob = typeof strategistJobsTable.$inferSelect;
export type StrategistJobInsert = typeof strategistJobsTable.$inferInsert;

export const aiLabPromptsTable = pgTable("ai_lab_prompts", {
  id: serial("id").primaryKey(),
  role: text("role").notNull(),
  promptText: text("prompt_text").notNull(),
  isActive: boolean("is_active").default(false).notNull(),
  isDefault: boolean("is_default").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type AiLabPrompt = typeof aiLabPromptsTable.$inferSelect;

export const scannerTelemetryTable = pgTable("scanner_telemetry", {
  id: serial("id").primaryKey(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
  mode: text("mode").notNull(),
  regime: jsonb("regime"),
  weightsUsed: jsonb("weights_used"),
  universeSize: integer("universe_size"),
  passedFilters: integer("passed_filters"),
  aboveThreshold: integer("above_threshold"),
  thresholdUsed: integer("threshold_used"),
  catalystBonusAppliedTo: jsonb("catalyst_bonus_applied_to"),
  results: jsonb("results"),
});

// Path A: canonical IV history accumulated daily from Schwab full chain.
// One row per (symbol, date). Source is always 'chain'. After 60+ days of
// per-symbol coverage we cut IVR computation over from `equity_daily.iv_30d_proxy`
// (HV-derived Path B fallback) to this table. Tracks which contract was
// picked so we can audit selection quality.
export const equityIvCanonicalTable = pgTable("equity_iv_canonical", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  date: date("date").notNull(),
  iv30d: real("iv_30d").notNull(),
  dteActual: integer("dte_actual").notNull(),
  strike: real("strike").notNull(),
  spot: real("spot").notNull(),
  source: text("source").notNull().default("chain"),
  collectedAt: timestamp("collected_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("eq_iv_canon_sym_date").on(t.symbol, t.date),
]);

export type EquityIvCanonical = typeof equityIvCanonicalTable.$inferSelect;

export const terminalWatchlistsTable = pgTable("terminal_watchlists", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  clientId: text("client_id").notNull(),
  name: text("name").notNull(),
  symbols: jsonb("symbols").$type<string[]>().notNull().default([]),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("terminal_watchlists_user_client").on(t.userId, t.clientId),
]);

export type TerminalWatchlist = typeof terminalWatchlistsTable.$inferSelect;

export const terminalPortfolioPrefsTable = pgTable("terminal_portfolio_prefs", {
  userId: text("user_id").primaryKey(),
  /** `all` or a Schwab account hashValue */
  viewSelection: text("view_selection").notNull().default("all"),
  defaultTradingAccountHash: text("default_trading_account_hash"),
  hideBalances: boolean("hide_balances").notNull().default(false),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type TerminalPortfolioPrefs = typeof terminalPortfolioPrefsTable.$inferSelect;

/** Precomputed scanner signals (LC130 refresh worker + sync GET /api/v2/scan). */
export const tickerSignalSnapshotTable = pgTable("ticker_signal_snapshot", {
  ticker: text("ticker").primaryKey(),
  sector: text("sector"),
  marketCapTier: text("market_cap_tier"),
  spot: numeric("spot"),
  dailyChangePct: numeric("daily_change_pct"),
  halted: boolean("halted").default(false),
  ivr: numeric("ivr"),
  ivrSource: text("ivr_source"),
  hv20: numeric("hv20"),
  hv30: numeric("hv30"),
  atmIvByExpiry: jsonb("atm_iv_by_expiry"),
  skew25dByExpiry: jsonb("skew_25d_by_expiry"),
  impliedMoveFrontPct: numeric("implied_move_front_pct"),
  impliedMoveFrontAbs: numeric("implied_move_front_abs"),
  atmOiFront: integer("atm_oi_front"),
  bidAskWidthAtmFront: numeric("bid_ask_width_atm_front"),
  flowSummary: jsonb("flow_summary"),
  earningsDate: date("earnings_date"),
  earningsDaysAway: integer("earnings_days_away"),
  earningsConfirmed: boolean("earnings_confirmed"),
  macroOverlapScore: numeric("macro_overlap_score"),
  regimeShockActive: boolean("regime_shock_active").default(false),
  compositeScore: numeric("composite_score"),
  componentScores: jsonb("component_scores"),
  /** Distribution stats from earnings history (gap, c2c, 5d, IV crush) + scoring helpers. */
  earningsEdgeSignature: jsonb("earnings_edge_signature"),
  /**
   * Current implied move vs IV30-proxy historical earnings-move distribution.
   * Historical moves use impliedMoveOneWeekFromIv(iv_pre) in polygonEarningsHistory (IV-derived).
   */
  impliedMoveRichness: jsonb("implied_move_richness"),
  liquidityAnchorScore: numeric("liquidity_anchor_score"),
  liquidityMaxOiBand: integer("liquidity_max_oi_band"),
  liquidityDeepestOiStrike: numeric("liquidity_deepest_oi_strike"),
  /** Sub-score keys that cleared the high threshold (scanner v1). */
  surfacingSubScores: text("surfacing_sub_scores").array(),
  disqualFlags: text("disqual_flags").array(),
  surfacingReasons: text("surfacing_reasons").array(),
  snapshotAt: timestamp("snapshot_at", { withTimezone: true }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  chainUpdatedAt: timestamp("chain_updated_at", { withTimezone: true }),
  flowUpdatedAt: timestamp("flow_updated_at", { withTimezone: true }),
  ivrUpdatedAt: timestamp("ivr_updated_at", { withTimezone: true }),
  earningsUpdatedAt: timestamp("earnings_updated_at", { withTimezone: true }),
});

export type TickerSignalSnapshot = typeof tickerSignalSnapshotTable.$inferSelect;

export const scannerHealthTable = pgTable("scanner_health", {
  id: serial("id").primaryKey(),
  cycleStartedAt: timestamp("cycle_started_at", { withTimezone: true }),
  cycleCompletedAt: timestamp("cycle_completed_at", { withTimezone: true }),
  tickersAttempted: integer("tickers_attempted"),
  tickersSucceeded: integer("tickers_succeeded"),
  tickersFailed: integer("tickers_failed"),
  failedTickers: jsonb("failed_tickers"),
}, (t) => [
  index("idx_sh_completed").on(t.cycleCompletedAt),
]);

export type ScannerHealth = typeof scannerHealthTable.$inferSelect;

/** Per-ticker OCC/tape coverage snapshot for one scanner_health cycle (LC130 worker). */
export const scannerTickerCycleCoverageTable = pgTable("scanner_ticker_cycle_coverage", {
  id: serial("id").primaryKey(),
  cycleId: integer("cycle_id")
    .references(() => scannerHealthTable.id, { onDelete: "cascade" })
    .notNull(),
  ticker: text("ticker").notNull(),
  chainContractCount: integer("chain_contract_count"),
  occAttempted: integer("occ_attempted").notNull().default(0),
  occCompleted: integer("occ_completed").notNull().default(0),
  occCoveragePct: numeric("occ_coverage_pct"),
  tradesInserted: integer("trades_inserted").notNull().default(0),
  tradesObserved: integer("trades_observed"),
  insertCoveragePct: numeric("insert_coverage_pct"),
  truncated: boolean("truncated").notNull().default(false),
  elapsedMs: integer("elapsed_ms").notNull().default(0),
  tier: text("tier").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("scanner_ticker_cycle_cov_cycle_idx").on(t.cycleId),
  index("scanner_ticker_cycle_cov_ticker_recorded_idx").on(t.ticker, t.recordedAt),
]);

export type ScannerTickerCycleCoverage = typeof scannerTickerCycleCoverageTable.$inferSelect;

/** Durable append-only log for emitTelemetry (ring buffer remains live UI source). */
export const telemetryEventsTable = pgTable(
  "telemetry_events",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    emittedAt: timestamp("emitted_at", { withTimezone: true }).defaultNow().notNull(),
    /** Logical source: server (HTTP + emitTelemetry) vs web (browser POST). */
    service: text("service").notNull().default("server"),
    system: text("system").notNull(),
    level: text("level").notNull(),
    message: text("message").notNull(),
    subsystem: text("subsystem"),
    details: jsonb("details").notNull().default(sql`'{}'::jsonb`),
    requestId: text("request_id"),
  },
  (t) => [
    index("telemetry_events_emitted_at_idx").on(desc(t.emittedAt)),
    index("telemetry_events_message_emitted_at_idx").on(t.message, desc(t.emittedAt)),
    index("telemetry_events_system_emitted_at_idx").on(t.system, desc(t.emittedAt)),
    index("telemetry_events_service_emitted_at_idx").on(t.service, desc(t.emittedAt)),
  ],
);

export type TelemetryEventRow = typeof telemetryEventsTable.$inferSelect;

/** IBKR tick-by-tick entitlement pilot (Settings UI); one row per 60s run. */
export const ibkrDiagnosticsRunsTable = pgTable("ibkr_diagnostics_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  runStartedAt: timestamp("run_started_at", { withTimezone: true }).notNull(),
  runCompletedAt: timestamp("run_completed_at", { withTimezone: true }).notNull(),
  durationSec: integer("duration_sec").notNull(),
  clientId: integer("client_id").notNull(),
  perSymbolResults: jsonb("per_symbol_results").notNull(),
  globalErrors: jsonb("global_errors").notNull(),
  summary: jsonb("summary").notNull(),
  triggeredByUserId: text("triggered_by_user_id").notNull(),
}, (t) => [
  index("ibkr_diagnostics_runs_started_idx").on(t.runStartedAt),
]);

export type IbkrDiagnosticsRun = typeof ibkrDiagnosticsRunsTable.$inferSelect;

/** Per-option-contract daily OHLCV from Polygon aggregates (tuning / research backfills). */
export const optionsDailyTable = pgTable(
  "options_daily",
  {
    occ: text("occ").notNull(),
    underlyingSymbol: text("underlying_symbol"),
    date: date("date").notNull(),
    open: real("open"),
    high: real("high"),
    low: real("low"),
    close: real("close").notNull(),
    volume: bigint("volume", { mode: "number" }),
    vwap: real("vwap"),
    transactions: integer("transactions"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.occ, t.date] }), index("idx_options_daily_occ_date_desc").on(t.occ, desc(t.date))],
);

export type OptionsDailyRow = typeof optionsDailyTable.$inferSelect;

export const dividendsTable = pgTable(
  "dividends",
  {
    symbol: text("symbol").notNull(),
    exDate: date("ex_date").notNull(),
    cashAmount: doublePrecision("cash_amount"),
    recordDate: date("record_date"),
    payDate: date("pay_date"),
    declarationDate: date("declaration_date"),
    currency: text("currency"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.exDate] }), index("idx_dividends_symbol_ex_desc").on(t.symbol, desc(t.exDate))],
);

export type DividendsRow = typeof dividendsTable.$inferSelect;

export const earningsReactionsTable = pgTable(
  "earnings_reactions",
  {
    symbol: text("symbol").notNull(),
    earningsDate: date("earnings_date").notNull(),
    tZeroDate: date("t_zero_date").notNull(),
    timeOfDay: text("time_of_day").notNull(),
    preEventClose: doublePrecision("pre_event_close"),
    eventOpen: doublePrecision("event_open"),
    eventClose: doublePrecision("event_close"),
    tplus1Close: doublePrecision("tplus1_close"),
    tplus5Close: doublePrecision("tplus5_close"),
    gapPct: doublePrecision("gap_pct"),
    intradayPct: doublePrecision("intraday_pct"),
    reaction1dPct: doublePrecision("reaction_1d_pct"),
    reaction5dPct: doublePrecision("reaction_5d_pct"),
    driftPostInitialPct: doublePrecision("drift_post_initial_pct"),
    maxDrawdown5dPct: doublePrecision("max_drawdown_5d_pct"),
    maxUpmove5dPct: doublePrecision("max_upmove_5d_pct"),
    volumeVs20dAvg: doublePrecision("volume_vs_20d_avg"),
    epsEstimate: doublePrecision("eps_estimate"),
    epsActual: doublePrecision("eps_actual"),
    epsSurprisePct: doublePrecision("eps_surprise_pct"),
    revenueEstimate: doublePrecision("revenue_estimate"),
    revenueActual: doublePrecision("revenue_actual"),
    revenueSurprisePct: doublePrecision("revenue_surprise_pct"),
    computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.symbol, t.earningsDate] }),
    index("idx_earnings_reactions_symbol_date").on(t.symbol, desc(t.earningsDate)),
  ],
);

export type EarningsReactionRow = typeof earningsReactionsTable.$inferSelect;

/** Persisted Schwab CHART_EQUITY 1-minute bars (Railway-survivable strategist VWAP/RSI walkback). */
export const schwabChartEquityBarsTable = pgTable(
  "schwab_chart_equity_bars",
  {
    symbol: text("symbol").notNull(),
    barTimeMs: bigint("bar_time_ms", { mode: "number" }).notNull(),
    high: numeric("high", { precision: 20, scale: 8 }).notNull(),
    low: numeric("low", { precision: 20, scale: 8 }).notNull(),
    close: numeric("close", { precision: 20, scale: 8 }).notNull(),
    volume: numeric("volume", { precision: 24, scale: 4 }).notNull(),
    sessionDate: date("session_date").notNull(),
    insertedAt: timestamp("inserted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.symbol, t.barTimeMs] }),
    index("schwab_chart_equity_bars_symbol_session_date_idx").on(t.symbol, t.sessionDate),
  ],
);

export type SchwabChartEquityBarRow = typeof schwabChartEquityBarsTable.$inferSelect;

export const backfillAuditRunsTable = pgTable("backfill_audit_runs", {
  runId: uuid("run_id").defaultRandom().primaryKey(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  universe: text("universe").notNull(),
  universeSize: integer("universe_size").notNull(),
  perSymbolAudit: jsonb("per_symbol_audit").notNull(),
  overallStatus: text("overall_status").notNull(),
  notes: text("notes"),
});

export type BackfillAuditRunRow = typeof backfillAuditRunsTable.$inferSelect;

/** Orchestrated LC130 ∪ tuning full backfill (admin POST /api/admin/run-full-backfill). */
export const backfillRunJobsTable = pgTable(
  "backfill_run_jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text("status").notNull(),
    perPipelineProgress: jsonb("per_pipeline_progress")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (t) => [index("backfill_run_jobs_started_at_idx").on(desc(t.startedAt))],
);

export type BackfillRunJobRow = typeof backfillRunJobsTable.$inferSelect;
export type BackfillRunJobInsert = typeof backfillRunJobsTable.$inferInsert;

/** Per-user AI chat threads (Markets CHAT tab). */
export const chatThreadsTable = pgTable(
  "chat_threads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    symbol: text("symbol"),
    title: text("title").notNull().default("Chat"),
    summary: text("summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("chat_threads_user_symbol_updated_idx").on(t.userId, t.symbol, desc(t.updatedAt))],
);

export type ChatThreadRow = typeof chatThreadsTable.$inferSelect;
export type ChatThreadInsert = typeof chatThreadsTable.$inferInsert;

export const chatMessagesTable = pgTable(
  "chat_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => chatThreadsTable.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content").notNull().default(""),
    toolCalls: jsonb("tool_calls").$type<unknown>(),
    toolResults: jsonb("tool_results").$type<unknown>(),
    attachments: jsonb("attachments").$type<
      Array<{
        id: string;
        name: string;
        mimeType: string;
        kind: "image" | "text";
        data: string;
      }>
    >(),
    tokenCount: integer("token_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("chat_messages_thread_created_idx").on(t.threadId, t.createdAt)],
);

export type ChatMessageRow = typeof chatMessagesTable.$inferSelect;
export type ChatMessageInsert = typeof chatMessagesTable.$inferInsert;

/** Latest polled FMP movers feed snapshots (JSON MoversFeed payload). */
export const moversFeedTable = pgTable(
  "movers_feed",
  {
    id: serial("id").primaryKey(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  },
  (t) => [index("movers_feed_captured_at_idx").on(desc(t.capturedAt))],
);

export type MoversFeedRow = typeof moversFeedTable.$inferSelect;
export type MoversFeedInsert = typeof moversFeedTable.$inferInsert;

/** Pre-earnings Catalysts snapshot cache (JSON CatalystsFeed payload). */
export const catalystsFeedTable = pgTable(
  "catalysts_feed",
  {
    id: serial("id").primaryKey(),
    builtAt: timestamp("built_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  },
  (t) => [index("catalysts_feed_built_at_idx").on(desc(t.builtAt))],
);

export type CatalystsFeedRow = typeof catalystsFeedTable.$inferSelect;
export type CatalystsFeedInsert = typeof catalystsFeedTable.$inferInsert;

/**
 * Catalysts earnings snapshot for S&P Composite 1500 (weekly harvest).
 * - `lastEarningsDate`: Schwab `/quotes` fundamental (reference; always harvested when present).
 * - `nextEarningsDate`: forward print from FMP-backed `corporate_events` (primary).
 */
export const catalystEarningsDatesTable = pgTable(
  "catalyst_earnings_dates",
  {
    symbol: text("symbol").primaryKey().notNull(),
    lastEarningsDate: date("last_earnings_date"),
    nextEarningsDate: date("next_earnings_date"),
    /** False = show EST. on Catalysts cards when sourced from FMP calendar. */
    earningsConfirmed: boolean("earnings_confirmed"),
    harvestedAt: timestamp("harvested_at", { withTimezone: true }).notNull(),
    sweepId: text("sweep_id"),
  },
  (t) => [
    index("catalyst_earnings_dates_next_date_idx").on(t.nextEarningsDate),
    index("catalyst_earnings_dates_harvested_at_idx").on(desc(t.harvestedAt)),
  ],
);

export type CatalystEarningsDateRow = typeof catalystEarningsDatesTable.$inferSelect;
export type CatalystEarningsDateInsert = typeof catalystEarningsDatesTable.$inferInsert;

/** Lazy LLM read cache keyed by driving-news fingerprint (7-day retention). */
export const moversCatalystCacheTable = pgTable(
  "movers_catalyst_cache",
  {
    newsKey: text("news_key").primaryKey(),
    read: text("read").notNull(),
    posture: text("posture").notNull(),
    confidence: text("confidence").notNull(),
    /** LLM-corrected catalyst type from expand-time read (applied on subsequent polls). */
    catalystType: text("catalyst_type"),
    catalystSummary: text("catalyst_summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("movers_catalyst_cache_created_at_idx").on(t.createdAt)],
);

export type MoversCatalystCacheRow = typeof moversCatalystCacheTable.$inferSelect;
export type MoversCatalystCacheInsert = typeof moversCatalystCacheTable.$inferInsert;

/** Poll-time tier-2 LLM catalyst cache keyed by deduped headline title set (7-day retention). */
export const moversTier2CacheTable = pgTable(
  "movers_tier2_cache",
  {
    headlineSetKey: text("headline_set_key").primaryKey(),
    catalystType: text("catalyst_type").notNull(),
    drivingHeadline: text("driving_headline").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("movers_tier2_cache_created_at_idx").on(t.createdAt)],
);

export type MoversTier2CacheRow = typeof moversTier2CacheTable.$inferSelect;
export type MoversTier2CacheInsert = typeof moversTier2CacheTable.$inferInsert;

/**
 * Auto Trader per-user config. One row per user. `tickers` is the universe the
 * LLM may trade; `instrumentMode` is "stock" | "options" | "both". Budget and
 * dailyMaxLoss are USD guardrails enforced before any order is placed.
 */
export const autoTradeConfigTable = pgTable("auto_trade_config", {
  userId: text("user_id").primaryKey(),
  enabled: boolean("enabled").default(false).notNull(),
  running: boolean("running").default(false).notNull(),
  accountHash: text("account_hash"),
  modelId: text("model_id").default("claude-opus-4-8").notNull(),
  tickers: jsonb("tickers").$type<string[]>().default([]).notNull(),
  instrumentMode: text("instrument_mode").default("stock").notNull(),
  totalBudget: real("total_budget").default(1000).notNull(),
  maxPerTrade: real("max_per_trade").default(300).notNull(),
  dailyMaxLoss: real("daily_max_loss").default(100).notNull(),
  pollIntervalSec: integer("poll_interval_sec").default(60).notNull(),
  enableExtendedHours: boolean("enable_extended_hours").default(false).notNull(),
  flattenAtClose: boolean("flatten_at_close").default(true).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type AutoTradeConfigRow = typeof autoTradeConfigTable.$inferSelect;
export type AutoTradeConfigInsert = typeof autoTradeConfigTable.$inferInsert;

/** Audit log of every auto-trader decision (placed or skipped) for transparency. */
export const autoTradeDecisionsTable = pgTable(
  "auto_trade_decisions",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    ticker: text("ticker").notNull(),
    decision: text("decision").notNull(),
    instrument: text("instrument"),
    quantity: integer("quantity"),
    notional: real("notional"),
    reasoning: text("reasoning"),
    modelId: text("model_id"),
    schwabOrderId: text("schwab_order_id"),
    placed: boolean("placed").default(false).notNull(),
    error: text("error"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // Outcome tracking — populated when the matching SELL fires
    exitPrice: real("exit_price"),
    exitAt: timestamp("exit_at"),
    pnl: real("pnl"),
    holdMinutes: integer("hold_minutes"),
    outcome: text("outcome"), // 'WIN' | 'LOSS' | 'BREAKEVEN'
  },
  (t) => [index("auto_trade_decisions_user_created_idx").on(t.userId, desc(t.createdAt))],
);

export type AutoTradeDecisionRow = typeof autoTradeDecisionsTable.$inferSelect;
export type AutoTradeDecisionInsert = typeof autoTradeDecisionsTable.$inferInsert;

/** Per-user LLM trading pattern playbook (generated nightly, injected into every decision call). */
export const autoTradePlaybookTable = pgTable("auto_trade_playbook", {
  userId: text("user_id").primaryKey(),
  content: text("content").default("").notNull(),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
  tradeCount: integer("trade_count").default(0).notNull(),
});

export type AutoTradePlaybookRow = typeof autoTradePlaybookTable.$inferSelect;
