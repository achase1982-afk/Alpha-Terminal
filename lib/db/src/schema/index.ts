import { pgTable, text, serial, real, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
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
