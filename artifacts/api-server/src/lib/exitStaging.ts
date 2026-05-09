import { db } from "@workspace/db";
import { tradeJournalTable, stagedExitsTable } from "@workspace/db/schema";
import { eq, and } from "@workspace/db";
import { getTokens } from "./tokenStore.js";
import { logger } from "./logger.js";
import { sendPushToAll } from "./pushService.js";
import { broadcastToClients } from "./wsServer.js";
import { logFailure } from "./telemetry.js";

const SCHWAB_TRADER_BASE = "https://api.schwabapi.com/trader/v1";

/** Leg objects stored in `trade_journal.legs` jsonb (Schwab-style order leg subset). */
interface JournalOrderLeg {
  instruction?: string;
  quantity?: number;
  symbol?: string;
  assetType?: string;
}

function getTraderToken(): string | null {
  const trader = getTokens("trader");
  return trader?.accessToken ?? null;
}

export async function handleFillForExitStaging(params: {
  schwabOrderId: string;
  symbol: string;
  side: string;
  quantity: string;
  executionPrice: string;
}) {
  const { schwabOrderId, symbol, side, quantity, executionPrice } = params;

  try {
    const [journalEntry] = await db
      .select()
      .from(tradeJournalTable)
      .where(eq(tradeJournalTable.schwabOrderId, schwabOrderId));

    if (!journalEntry) {
      logger.info({ schwabOrderId, symbol }, "No journal entry for filled order — skipping exit staging (external trade)");
      return;
    }

    if (!journalEntry.isCredit || !journalEntry.strategyType) {
      logger.info({ schwabOrderId, symbol, strategyType: journalEntry.strategyType }, "Not a credit strategy — skipping auto exit");
      return;
    }

    const existingExits = await db
      .select()
      .from(stagedExitsTable)
      .where(and(
        eq(stagedExitsTable.schwabEntryOrderId, schwabOrderId),
        eq(stagedExitsTable.exitType, "PROFIT_TARGET"),
      ));
    if (existingExits.length > 0) {
      logger.info({ schwabOrderId }, "Exit already staged for this order — idempotency guard");
      return;
    }

    const entryCredit = journalEntry.entryPrice ?? parseFloat(executionPrice);
    if (!entryCredit || entryCredit <= 0) {
      logger.warn({ schwabOrderId }, "No entry credit available for exit calculation");
      return;
    }

    const profitTargetPct = 50;
    const targetDebit = parseFloat((entryCredit * (1 - profitTargetPct / 100)).toFixed(2));

    logger.info({
      schwabOrderId,
      symbol,
      entryCredit,
      profitTargetPct,
      targetDebit,
    }, "Staging GTC exit order for profit target");

    const rawLegs = journalEntry.legs;
    const legs: JournalOrderLeg[] | null = Array.isArray(rawLegs) ? (rawLegs as JournalOrderLeg[]) : null;
    if (!legs || legs.length === 0) {
      logger.warn({ schwabOrderId }, "No leg data in journal — cannot build exit order");
      return;
    }

    const exitLegs = legs.map((leg) => {
      const instruction = leg.instruction?.includes("SELL") ? leg.instruction.replace("SELL", "BUY") : leg.instruction?.replace("BUY", "SELL");
      return {
        instruction,
        quantity: leg.quantity ?? parseInt(quantity) ?? 1,
        instrument: { symbol: leg.symbol, assetType: leg.assetType ?? "OPTION" },
      };
    });

    const exitOrder = {
      orderType: "NET_DEBIT",
      session: "NORMAL",
      duration: "GOOD_TILL_CANCEL",
      price: targetDebit,
      complexOrderStrategyType: exitLegs.length > 1 ? "VERTICAL" : "NONE",
      orderStrategyType: "SINGLE",
      orderLegCollection: exitLegs,
    };

    const token = getTraderToken();
    if (!token) {
      logger.error("No trader token for exit order placement");
      void logFailure("EXIT_STAGING", "ERROR", `No trader token for exit order placement`, { schwabOrderId, symbol });
      return;
    }

    const accountHash = journalEntry.accountHash;
    if (!accountHash) {
      logger.error({ schwabOrderId }, "No account hash on journal entry — cannot place exit");
      return;
    }
    const schwabRes = await fetch(
      `${SCHWAB_TRADER_BASE}/accounts/${accountHash}/orders`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(exitOrder),
      }
    );

    let exitOrderId: string | null = null;
    if (schwabRes.ok) {
      const loc = schwabRes.headers.get("location") ?? "";
      const m = loc.match(/orders\/(\d+)/);
      exitOrderId = m ? m[1] : null;
      logger.info({ exitOrderId, symbol, targetDebit }, "GTC exit order placed successfully");
    } else {
      const body = await schwabRes.text().catch(() => "");
      logger.error({ status: schwabRes.status, body: body.slice(0, 300) }, "Exit order placement failed");
      void logFailure("EXIT_STAGING", "ERROR", `Exit order placement failed: HTTP ${schwabRes.status}`, { schwabOrderId, symbol, status: schwabRes.status, body: body.slice(0, 300) });
    }

    const dte = journalEntry.legs ? estimateDTE(legs) : null;

    await db.insert(stagedExitsTable).values({
      journalEntryId: journalEntry.id,
      schwabEntryOrderId: schwabOrderId,
      schwabExitOrderId: exitOrderId,
      symbol,
      exitType: "PROFIT_TARGET",
      targetPrice: targetDebit,
      entryCredit,
      strategyType: journalEntry.strategyType,
      dte,
      entryTimestamp: new Date(),
      status: exitOrderId ? "ACTIVE" : "FAILED",
    });

    if (exitOrderId) {
      void sendPushToAll({
        title: "ALPHA TERMINAL",
        body: `Exit staged: ${symbol} GTC buy-to-close @ $${targetDebit} (50% profit target)`,
        tag: "ExitStaged",
        data: { exitOrderId, symbol },
      });

      broadcastToClients("exitStaged", {
        symbol,
        exitOrderId,
        targetDebit,
        entryCredit,
        timestamp: Date.now(),
      });
    }
  } catch (err) {
    logger.error({ err, schwabOrderId }, "Exit staging error");
    void logFailure("EXIT_STAGING", "ERROR", `Exit staging error for ${symbol}: ${String(err)}`, { schwabOrderId, symbol, error: String(err) });
  }
}

function estimateDTE(legs: any[]): number | null {
  for (const leg of legs) {
    const sym = leg.symbol ?? "";
    const match = sym.match(/\s+(\d{6})[CP]/);
    if (match) {
      const dateStr = match[1];
      const month = parseInt(dateStr.slice(0, 2));
      const day = parseInt(dateStr.slice(2, 4));
      const year = 2000 + parseInt(dateStr.slice(4, 6));
      const expDate = new Date(year, month - 1, day);
      const now = new Date();
      const diffMs = expDate.getTime() - now.getTime();
      return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
    }
  }
  return null;
}

let monitorInterval: ReturnType<typeof setInterval> | null = null;

export function startExitMonitor() {
  if (monitorInterval) return;
  monitorInterval = setInterval(runExitMonitorCycle, 60_000);
  logger.info("Exit monitor started (60s interval)");
}

async function runExitMonitorCycle() {
  try {
    const activeExits = await db
      .select()
      .from(stagedExitsTable)
      .where(eq(stagedExitsTable.status, "ACTIVE"));

    if (activeExits.length === 0) return;

    const now = new Date();

    for (const exit of activeExits) {
      if (!exit.entryCredit || exit.entryCredit <= 0) continue;
      if (!exit.entryTimestamp) continue;

      const dte = exit.dte;
      if (!dte || dte <= 0) continue;

      const elapsedMs = now.getTime() - new Date(exit.entryTimestamp).getTime();
      const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);
      const timeElapsedPct = (elapsedDays / dte) * 100;

      if (timeElapsedPct >= 50 && !exit.timeAlert50Sent) {
        void sendPushToAll({
          title: "ALPHA TERMINAL",
          body: `Time check: ${exit.symbol} ${exit.strategyType ?? ""} is at 50% of time elapsed. Consider managing.`,
          tag: "TimeAlert50",
          data: { symbol: exit.symbol },
        });
        await db.update(stagedExitsTable)
          .set({ timeAlert50Sent: true })
          .where(eq(stagedExitsTable.id, exit.id));
      }

      if (timeElapsedPct >= 75 && !exit.timeAlert75Sent) {
        void sendPushToAll({
          title: "ALPHA TERMINAL",
          body: `Time stop approaching: ${exit.symbol} has used 75% of its time. Consider managing.`,
          tag: "TimeAlert75",
          data: { symbol: exit.symbol },
        });
        await db.update(stagedExitsTable)
          .set({ timeAlert75Sent: true })
          .where(eq(stagedExitsTable.id, exit.id));
      }

      const daysToExp = dte - elapsedDays;
      if (daysToExp <= 1 && !exit.expirationAlertSent) {
        void sendPushToAll({
          title: "ALPHA TERMINAL",
          body: `Expiration tomorrow: ${exit.symbol} ${exit.strategyType ?? ""} expires tomorrow. Close or manage now.`,
          tag: "ExpirationAlert",
          data: { symbol: exit.symbol },
        });
        await db.update(stagedExitsTable)
          .set({ expirationAlertSent: true })
          .where(eq(stagedExitsTable.id, exit.id));
      }
    }
  } catch (err) {
    logger.error({ err }, "Exit monitor cycle error");
    void logFailure("EXIT_STAGING", "ERROR", `Exit monitor cycle error: ${String(err)}`, { error: String(err) });
  }
}

export async function checkStopLoss(symbol: string, currentSpreadValue: number) {
  try {
    const exits = await db
      .select()
      .from(stagedExitsTable)
      .where(and(
        eq(stagedExitsTable.symbol, symbol),
        eq(stagedExitsTable.status, "ACTIVE"),
        eq(stagedExitsTable.stopAlertSent, false),
      ));

    for (const exit of exits) {
      if (!exit.entryCredit || exit.entryCredit <= 0) continue;
      const stopThreshold = exit.entryCredit * 2;

      if (currentSpreadValue >= stopThreshold) {
        void sendPushToAll({
          title: "ALPHA TERMINAL",
          body: `Stop alert: ${symbol} ${exit.strategyType ?? ""} has reached 2x loss. Current value $${currentSpreadValue.toFixed(2)} vs entry credit $${exit.entryCredit.toFixed(2)}. Consider closing.`,
          tag: "StopAlert",
          data: { symbol },
        });

        await db.update(stagedExitsTable)
          .set({ stopAlertSent: true })
          .where(eq(stagedExitsTable.id, exit.id));

        logger.info({ symbol, currentSpreadValue, entryCredit: exit.entryCredit }, "Stop loss alert sent");
      }
    }
  } catch (err) {
    logger.error({ err, symbol }, "Stop loss check error");
    void logFailure("EXIT_STAGING", "ERROR", `Stop loss check error for ${symbol}: ${String(err)}`, { symbol, error: String(err) });
  }
}
