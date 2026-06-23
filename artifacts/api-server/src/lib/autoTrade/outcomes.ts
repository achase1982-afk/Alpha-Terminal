import { db, eq, and, isNull, isNotNull, desc } from "@workspace/db";
import { autoTradeDecisionsTable, autoTradePlaybookTable } from "@workspace/db/schema";
import { logger } from "../logger.js";

const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/**
 * After a SELL fills, find the most recent open BUY for this ticker and persist
 * the outcome: P&L, hold time, WIN/LOSS/BREAKEVEN. Non-throwing.
 */
export async function recordTradeExit(
  userId: string,
  ticker: string,
  exitPrice: number,
  quantity: number,
): Promise<void> {
  try {
    const [entry] = await db
      .select()
      .from(autoTradeDecisionsTable)
      .where(
        and(
          eq(autoTradeDecisionsTable.userId, userId),
          eq(autoTradeDecisionsTable.ticker, ticker.toUpperCase()),
          eq(autoTradeDecisionsTable.decision, "BUY_STOCK"),
          eq(autoTradeDecisionsTable.placed, true),
          isNull(autoTradeDecisionsTable.exitAt),
        ),
      )
      .orderBy(desc(autoTradeDecisionsTable.createdAt))
      .limit(1);

    if (!entry) return;

    // Derive entry price from notional / quantity stored at order time
    const entryPrice =
      entry.notional != null && entry.quantity != null && entry.quantity > 0
        ? entry.notional / entry.quantity
        : null;
    if (entryPrice == null) return;

    const pnl = (exitPrice - entryPrice) * quantity;
    const holdMs = entry.createdAt ? Date.now() - new Date(entry.createdAt).getTime() : 0;
    const holdMinutes = Math.max(0, Math.round(holdMs / 60_000));
    const outcome = pnl > 0.01 ? "WIN" : pnl < -0.01 ? "LOSS" : "BREAKEVEN";

    await db
      .update(autoTradeDecisionsTable)
      .set({ exitPrice, exitAt: new Date(), pnl, holdMinutes, outcome })
      .where(eq(autoTradeDecisionsTable.id, entry.id));
  } catch (err) {
    logger.warn({ err, userId, ticker }, "autoTrade: recordTradeExit failed");
  }
}

/**
 * Query all completed trades for this user, compute deterministic pattern stats
 * (win rates by ticker / time-of-day / day-of-week), and store as a plain-text
 * playbook. No LLM call — pure math. Non-throwing.
 */
export async function generateAndStorePlaybook(userId: string): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(autoTradeDecisionsTable)
      .where(
        and(
          eq(autoTradeDecisionsTable.userId, userId),
          eq(autoTradeDecisionsTable.decision, "BUY_STOCK"),
          eq(autoTradeDecisionsTable.placed, true),
          isNotNull(autoTradeDecisionsTable.outcome),
        ),
      )
      .orderBy(desc(autoTradeDecisionsTable.createdAt))
      .limit(500);

    if (!rows.length) return;

    const content = buildPlaybookText(rows);
    const tradeCount = rows.length;

    await db
      .insert(autoTradePlaybookTable)
      .values({ userId, content, tradeCount, generatedAt: new Date() })
      .onConflictDoUpdate({
        target: autoTradePlaybookTable.userId,
        set: { content, tradeCount, generatedAt: new Date() },
      });
  } catch (err) {
    logger.warn({ err, userId }, "autoTrade: generateAndStorePlaybook failed");
  }
}

/** Read the stored playbook for injection into the LLM decision context. Returns null if none yet. */
export async function getStoredPlaybook(userId: string): Promise<string | null> {
  try {
    const [row] = await db
      .select()
      .from(autoTradePlaybookTable)
      .where(eq(autoTradePlaybookTable.userId, userId))
      .limit(1);
    return row?.content ?? null;
  } catch {
    return null;
  }
}

// ─── Internal helpers ────────────────────────────────────────────────────────

type TradeRow = typeof autoTradeDecisionsTable.$inferSelect;

function buildPlaybookText(rows: TradeRow[]): string {
  const total = rows.length;
  const wins = rows.filter((r) => r.outcome === "WIN").length;
  const losses = rows.filter((r) => r.outcome === "LOSS").length;
  const overallWr = Math.round((wins / total) * 100);
  const avgPnl = mean(rows.map((r) => r.pnl ?? 0));
  const avgHold = mean(rows.map((r) => r.holdMinutes ?? 0));

  // Per-ticker stats
  const byTicker = groupBy(rows, (r) => r.ticker);
  const tickerLines = Object.entries(byTicker)
    .map(([ticker, trades]) => {
      const tw = trades.filter((t) => t.outcome === "WIN").length;
      const wr = Math.round((tw / trades.length) * 100);
      const pa = mean(trades.map((t) => t.pnl ?? 0));
      const ha = mean(trades.map((t) => t.holdMinutes ?? 0));
      const flag = wr >= 60 ? "✓ STRONG" : wr <= 40 ? "⚠ STRUGGLING" : "~ NEUTRAL";
      return `  ${ticker.padEnd(8)} ${trades.length} trades | ${wr}% win | avg P&L ${pa >= 0 ? "+" : ""}$${pa.toFixed(0)} | avg hold ${ha.toFixed(0)} min  ${flag}`;
    })
    .sort()
    .join("\n");

  // Time-of-day buckets (ET hour)
  const byHour = groupBy(rows, (r) => {
    const et = new Date(r.createdAt.toLocaleString("en-US", { timeZone: "America/New_York" }));
    return String(et.getHours());
  });
  const hourLines = Object.entries(byHour)
    .filter(([, t]) => t.length >= 3)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([hour, trades]) => {
      const h = Number(hour);
      const tw = trades.filter((t) => t.outcome === "WIN").length;
      const wr = Math.round((tw / trades.length) * 100);
      const label =
        h < 10 ? "OPENING" : h < 12 ? "MID-MORNING" : h < 14 ? "MIDDAY" : "AFTERNOON";
      const flag = wr >= 60 ? "↑" : wr <= 40 ? "↓ AVOID" : "";
      return `  ${String(h).padStart(2)}:00–${h + 1}:00 ET  ${wr}% win (${trades.length} trades)  ${label}  ${flag}`;
    })
    .join("\n");

  // Day-of-week stats
  const byDay = groupBy(rows, (r) => {
    const et = new Date(r.createdAt.toLocaleString("en-US", { timeZone: "America/New_York" }));
    return DAY_NAMES[et.getDay()];
  });
  const dayLine = Object.entries(byDay)
    .filter(([, t]) => t.length >= 2)
    .map(([day, trades]) => {
      const tw = trades.filter((t) => t.outcome === "WIN").length;
      const wr = Math.round((tw / trades.length) * 100);
      return `${day}: ${wr}% (${trades.length})`;
    })
    .join(" | ");

  // Failure note from losing trades
  const lossCount = rows.filter((r) => r.outcome === "LOSS").length;
  const failureLine =
    lossCount >= 5
      ? `${lossCount} losing trades on record — review time-of-day patterns above for avoidance windows.`
      : "";

  const sections: string[] = [
    `═══ YOUR TRADING PATTERN MEMORY ═══`,
    `Based on ${total} completed trades: ${wins} wins / ${losses} losses = ${overallWr}% overall win rate`,
    `Avg P&L per trade: ${avgPnl >= 0 ? "+" : ""}$${avgPnl.toFixed(0)} | Avg hold: ${avgHold.toFixed(0)} min`,
    ``,
    `TICKER PERFORMANCE:`,
    tickerLines || `  (no per-ticker data yet)`,
  ];

  if (hourLines) {
    sections.push(``, `TIME-OF-DAY PATTERNS (ET):`, hourLines);
  }
  if (dayLine) {
    sections.push(``, `DAY OF WEEK:`, `  ${dayLine}`);
  }
  if (failureLine) {
    sections.push(``, `FAILURE PATTERN NOTE:`, `  ${failureLine}`);
  }
  sections.push(`═══════════════════════════════════════`);

  return sections.join("\n");
}

function mean(nums: number[]): number {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of arr) {
    const k = key(item);
    (result[k] ??= []).push(item);
  }
  return result;
}
