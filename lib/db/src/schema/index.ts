import { pgTable, text, serial, real, integer, boolean, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
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
