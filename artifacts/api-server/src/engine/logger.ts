/**
 * SQLite trade log — fast, synchronous, no PostgreSQL dependency.
 * Persists signals, fills, and exits for the current trading day.
 * The file is ephemeral (resets on deploy) which is fine for an intraday engine.
 */
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import type { Signal, Fill, ExitRecord } from "./types.js";

let _db: Database.Database | null = null;

function db(): Database.Database {
  if (_db) return _db;
  throw new Error("Engine logger not initialized — call initLogger() first");
}

export function initLogger(dbPath: string): void {
  const dir = path.dirname(dbPath);
  if (dir && dir !== ".") fs.mkdirSync(dir, { recursive: true });

  _db = new Database(dbPath);
  _db.pragma("journal_mode = WAL");

  _db.exec(`
    CREATE TABLE IF NOT EXISTS signals (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ts         TEXT NOT NULL,
      symbol     TEXT NOT NULL,
      action     TEXT NOT NULL,
      entry      REAL NOT NULL,
      stop       REAL NOT NULL,
      target     REAL NOT NULL,
      size       INTEGER NOT NULL,
      confidence REAL NOT NULL,
      reason     TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fills (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id   TEXT NOT NULL,
      symbol     TEXT NOT NULL,
      action     TEXT NOT NULL,
      price      REAL NOT NULL,
      quantity   INTEGER NOT NULL,
      filled_at  TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS exits (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_order_id  TEXT NOT NULL,
      exit_order_id   TEXT NOT NULL,
      symbol          TEXT NOT NULL,
      entry_price     REAL NOT NULL,
      exit_price      REAL NOT NULL,
      quantity        INTEGER NOT NULL,
      pnl             REAL NOT NULL,
      exit_reason     TEXT NOT NULL,
      exit_at         TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS evaluations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ts         TEXT NOT NULL,
      symbol     TEXT NOT NULL,
      action     TEXT NOT NULL,
      reason     TEXT NOT NULL,
      last       REAL,
      vwap       REAL,
      lower_rail REAL,
      rsi        REAL,
      vol_ratio  REAL
    );
  `);
}

/** One evaluation row per symbol per tick — the engine's continuous decision trail. */
export function logEvaluation(e: {
  symbol: string;
  action: string;
  reason: string;
  last: number;
  vwap: number;
  lowerRail: number;
  rsi: number;
  volRatio: number;
}): void {
  if (!_db) return; // logging is best-effort; never block the hot loop
  db().prepare(`
    INSERT INTO evaluations (ts, symbol, action, reason, last, vwap, lower_rail, rsi, vol_ratio)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(new Date().toISOString(), e.symbol, e.action, e.reason, e.last, e.vwap, e.lowerRail, e.rsi, e.volRatio);
}

export function logSignal(s: Signal): void {
  db().prepare(`
    INSERT INTO signals (ts, symbol, action, entry, stop, target, size, confidence, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(s.timestamp.toISOString(), s.symbol, s.action, s.entryPrice, s.stopPrice, s.targetPrice, s.size, s.confidence, s.reason);
}

export function logFill(f: Fill): void {
  db().prepare(`
    INSERT INTO fills (order_id, symbol, action, price, quantity, filled_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(f.orderId, f.symbol, f.action, f.price, f.quantity, f.filledAt.toISOString());
}

export function logExit(e: ExitRecord): void {
  db().prepare(`
    INSERT INTO exits (entry_order_id, exit_order_id, symbol, entry_price, exit_price, quantity, pnl, exit_reason, exit_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(e.entryOrderId, e.exitOrderId, e.symbol, e.entryPrice, e.exitPrice, e.quantity, e.pnl, e.exitReason, e.exitAt.toISOString());
}

/** Realized P&L from exits today (ET calendar date). */
export function getTodayPnl(): number {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  const row = db()
    .prepare("SELECT COALESCE(SUM(pnl), 0) as total FROM exits WHERE exit_at LIKE ?")
    .get(`${today}%`) as { total: number };
  return row.total;
}

/** Consecutive losses counting from the most recent exit backwards. */
export function getLossStreak(): number {
  const rows = db()
    .prepare("SELECT pnl FROM exits ORDER BY exit_at DESC LIMIT 20")
    .all() as Array<{ pnl: number }>;
  let streak = 0;
  for (const row of rows) {
    if (row.pnl < 0) streak++;
    else break;
  }
  return streak;
}

/** Today's exits for the status dashboard. */
export function getTodayTrades(): unknown[] {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  return db()
    .prepare("SELECT * FROM exits WHERE exit_at LIKE ? ORDER BY exit_at DESC")
    .all(`${today}%`);
}

/** Today's signals for the dashboard. */
export function getTodaySignals(): unknown[] {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  return db()
    .prepare("SELECT * FROM signals WHERE ts LIKE ? ORDER BY ts DESC")
    .all(`${today}%`);
}
