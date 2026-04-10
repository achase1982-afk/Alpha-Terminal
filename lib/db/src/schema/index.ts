import { pgTable, text, serial, real, integer, boolean, timestamp, jsonb, uniqueIndex, date, doublePrecision, bigint } from "drizzle-orm/pg-core";
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
  hv20d: real("hv_20d"),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type OptionsFlowRawTrade = typeof optionsFlowRawTradesTable.$inferSelect;

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
  splitDate: date("split_date"),
  splitRatio: text("split_ratio"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("corp_events_sym").on(t.symbol),
]);

export type CorporateEvent = typeof corporateEventsTable.$inferSelect;

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

  status: text("status").notNull().default("NEW"),
  invalidatedReason: text("invalidated_reason"),
  closedAt: timestamp("closed_at"),

  sector: text("sector"),
}, (t) => [
  uniqueIndex("ai_lab_ideas_sym_status").on(t.symbol, t.status),
]);

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
