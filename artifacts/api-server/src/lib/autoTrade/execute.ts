import { db } from "@workspace/db";
import { autoTradeDecisionsTable, tradeJournalTable } from "@workspace/db/schema";
import { getTokens } from "../tokenStore.js";
import { logger } from "../logger.js";
import { broadcastToClients } from "../wsServer.js";
import { sendPushToAll } from "../pushService.js";
import { markAlertSeen } from "../schwabStreamer.js";

const SCHWAB_TRADER_BASE = "https://api.schwabapi.com/trader/v1";

export type EquityInstruction = "BUY" | "SELL";

export interface PlaceEquityResult {
  ok: boolean;
  orderId: string | null;
  error?: string;
}

/**
 * Place a single-leg equity MARKET order via the Schwab Trader API. Mirrors the
 * manual /portfolio/place-order path but is self-contained so the autonomous
 * engine never depends on the HTTP request lifecycle.
 */
export async function placeAutoEquityOrder(
  accountHash: string,
  symbol: string,
  instruction: EquityInstruction,
  quantity: number,
): Promise<PlaceEquityResult> {
  const token = getTokens("trader")?.accessToken;
  if (!token) return { ok: false, orderId: null, error: "no_trader_token" };
  if (!accountHash) return { ok: false, orderId: null, error: "no_account" };
  if (!Number.isFinite(quantity) || quantity < 1) {
    return { ok: false, orderId: null, error: "invalid_quantity" };
  }

  const order = {
    orderType: "MARKET",
    session: "NORMAL",
    duration: "DAY",
    orderStrategyType: "SINGLE",
    orderLegCollection: [
      {
        instruction,
        quantity,
        instrument: { symbol: symbol.toUpperCase(), assetType: "EQUITY" },
      },
    ],
  };

  try {
    const schwabRes = await fetch(`${SCHWAB_TRADER_BASE}/accounts/${accountHash}/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(order),
    });

    if (!schwabRes.ok) {
      const body = await schwabRes.text().catch(() => "");
      logger.error(
        { status: schwabRes.status, body: body.slice(0, 300), symbol },
        "autoTrade equity order rejected",
      );
      return { ok: false, orderId: null, error: body.slice(0, 200) || `http_${schwabRes.status}` };
    }

    const location = schwabRes.headers.get("location") ?? "";
    const orderId = location.match(/orders\/(\d+)/)?.[1] ?? null;

    if (orderId) {
      markAlertSeen(orderId, "OrderCreated");
      markAlertSeen(orderId, "OrderAccepted");
    }

    broadcastToClients("orderAlert", {
      type: "OrderCreated",
      symbol: symbol.toUpperCase(),
      side: instruction,
      quantity: String(quantity),
      orderId,
      status: "CREATED",
      timestamp: Date.now(),
      raw: "auto-trader",
    });

    void sendPushToAll({
      title: "ALPHA AUTO-TRADER",
      body: `${instruction} ${quantity} ${symbol.toUpperCase()} placed`,
      tag: "OrderCreated",
      data: { orderId, symbol: symbol.toUpperCase() },
    });

    return { ok: true, orderId };
  } catch (err) {
    logger.error({ err, symbol }, "autoTrade equity order error");
    return { ok: false, orderId: null, error: "schwab_api_error" };
  }
}

/**
 * Place a TRIGGER order: a BUY MARKET entry that, once filled, automatically
 * activates a child TRAILING_STOP SELL order at the specified percentage below
 * the high-water mark. This is the primary exit mechanism for auto-trades —
 * the bot enters, the trailing stop manages the exit without requiring a SELL
 * signal from the LLM on the next cycle.
 */
export async function placeAutoEquityOrderWithTrailingStop(
  accountHash: string,
  symbol: string,
  quantity: number,
  trailPercent: number,
): Promise<PlaceEquityResult> {
  const token = getTokens("trader")?.accessToken;
  if (!token) return { ok: false, orderId: null, error: "no_trader_token" };
  if (!accountHash) return { ok: false, orderId: null, error: "no_account" };
  if (!Number.isFinite(quantity) || quantity < 1) {
    return { ok: false, orderId: null, error: "invalid_quantity" };
  }
  if (!Number.isFinite(trailPercent) || trailPercent <= 0) {
    return { ok: false, orderId: null, error: "invalid_trail_percent" };
  }

  const sym = symbol.toUpperCase();
  const roundedTrail = Math.round(trailPercent * 100) / 100;

  const order = {
    orderStrategyType: "TRIGGER",
    session: "NORMAL",
    duration: "DAY",
    orderType: "MARKET",
    orderLegCollection: [
      {
        instruction: "BUY",
        quantity,
        instrument: { symbol: sym, assetType: "EQUITY" },
      },
    ],
    childOrderStrategies: [
      {
        orderStrategyType: "SINGLE",
        session: "NORMAL",
        duration: "DAY",
        orderType: "TRAILING_STOP",
        stopPriceLinkBasis: "LAST",
        stopPriceLinkType: "PERCENT",
        stopPriceOffset: roundedTrail,
        orderLegCollection: [
          {
            instruction: "SELL",
            quantity,
            instrument: { symbol: sym, assetType: "EQUITY" },
          },
        ],
      },
    ],
  };

  try {
    const schwabRes = await fetch(`${SCHWAB_TRADER_BASE}/accounts/${accountHash}/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(order),
    });

    if (!schwabRes.ok) {
      const body = await schwabRes.text().catch(() => "");
      logger.error(
        { status: schwabRes.status, body: body.slice(0, 300), symbol: sym, trailPercent: roundedTrail },
        "autoTrade trailing-stop trigger order rejected",
      );
      return { ok: false, orderId: null, error: body.slice(0, 200) || `http_${schwabRes.status}` };
    }

    const location = schwabRes.headers.get("location") ?? "";
    const orderId = location.match(/orders\/(\d+)/)?.[1] ?? null;

    if (orderId) {
      markAlertSeen(orderId, "OrderCreated");
      markAlertSeen(orderId, "OrderAccepted");
    }

    broadcastToClients("orderAlert", {
      type: "OrderCreated",
      symbol: sym,
      side: "BUY",
      quantity: String(quantity),
      orderId,
      status: "CREATED",
      trailPercent: roundedTrail,
      timestamp: Date.now(),
      raw: "auto-trader-trigger",
    });

    void sendPushToAll({
      title: "ALPHA AUTO-TRADER",
      body: `BUY ${quantity} ${sym} + ${roundedTrail.toFixed(2)}% trailing stop`,
      tag: "OrderCreated",
      data: { orderId, symbol: sym },
    });

    return { ok: true, orderId };
  } catch (err) {
    logger.error({ err, symbol: sym }, "autoTrade trailing-stop order error");
    return { ok: false, orderId: null, error: "schwab_api_error" };
  }
}

export interface DecisionLogInput {
  userId: string;
  ticker: string;
  decision: string;
  instrument?: string | null;
  quantity?: number | null;
  notional?: number | null;
  reasoning?: string | null;
  modelId?: string | null;
  schwabOrderId?: string | null;
  placed: boolean;
  error?: string | null;
}

/** Append a row to the auto_trade_decisions audit log (best-effort, non-throwing). */
export async function logAutoTradeDecision(input: DecisionLogInput): Promise<void> {
  try {
    await db.insert(autoTradeDecisionsTable).values({
      userId: input.userId,
      ticker: input.ticker.toUpperCase(),
      decision: input.decision,
      instrument: input.instrument ?? null,
      quantity: input.quantity ?? null,
      notional: input.notional ?? null,
      reasoning: input.reasoning ?? null,
      modelId: input.modelId ?? null,
      schwabOrderId: input.schwabOrderId ?? null,
      placed: input.placed,
      error: input.error ?? null,
    });
  } catch (err) {
    logger.warn({ err, ticker: input.ticker }, "logAutoTradeDecision failed");
  }
}

/** Write a trade_journal entry for a filled auto-trade entry (best-effort). */
export async function journalAutoEntry(input: {
  orderId: string;
  symbol: string;
  direction: string;
  entryPrice: number | null;
  quantity: number;
  thesis: string;
  accountHash: string;
}): Promise<void> {
  try {
    await db.insert(tradeJournalTable).values({
      schwabOrderId: input.orderId,
      symbol: input.symbol.toUpperCase(),
      strategyType: "AUTO_EQUITY",
      direction: input.direction,
      tradingModeLabel: "Auto Trader",
      entryPrice: input.entryPrice,
      thesis: input.thesis,
      quantity: input.quantity,
      accountHash: input.accountHash,
    });
  } catch (err) {
    logger.warn({ err, symbol: input.symbol }, "journalAutoEntry failed");
  }
}
