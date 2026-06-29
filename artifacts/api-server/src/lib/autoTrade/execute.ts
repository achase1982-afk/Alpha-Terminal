import { db } from "@workspace/db";
import { autoTradeDecisionsTable, tradeJournalTable } from "@workspace/db/schema";
import { getTokens } from "../tokenStore.js";
import { logger } from "../logger.js";
import { broadcastToClients } from "../wsServer.js";
import { sendPushToAll } from "../pushService.js";
import { markAlertSeen } from "../schwabStreamer.js";

const SCHWAB_TRADER_BASE = "https://api.schwabapi.com/trader/v1";

export type EquityInstruction = "BUY" | "SELL";

/** Schwab order session strings. NORMAL = regular hours; AM = pre-market; PM = after-hours. */
export type SchwabSession = "NORMAL" | "AM" | "PM";

/**
 * Determine the correct Schwab order session for the current ET wall-clock time.
 * - Pre-market  7:00 AM – 9:30 AM ET  → "AM"
 * - Regular     9:30 AM – 4:00 PM ET  → "NORMAL"
 * - After-hours 4:00 PM – 8:00 PM ET  → "PM"
 * - Outside all windows                → "NORMAL" (engine guards against placing orders when closed)
 */
export function currentSchwabSession(): SchwabSession {
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return "NORMAL"; // weekend — market guard handles the skip
  const minutes = et.getHours() * 60 + et.getMinutes();
  if (minutes >= 7 * 60 && minutes < 9 * 60 + 30) return "AM";
  if (minutes >= 16 * 60 && minutes < 20 * 60) return "PM";
  return "NORMAL";
}

export interface PlaceEquityResult {
  ok: boolean;
  orderId: string | null;
  error?: string;
  /** True only when a TRIGGER+trailing-stop child was successfully placed. False means a plain MARKET order was used (fallback or explicit SELL). */
  trailingStopPlaced?: boolean;
}

/**
 * Place a single-leg equity order via the Schwab Trader API.
 *
 * Session is auto-detected from the current ET wall-clock time:
 * - Regular hours  → MARKET order, session NORMAL
 * - Pre/after-hours → LIMIT order, session AM/PM
 *
 * Extended-hours LIMIT price: BUY at +1% above last, SELL at -1% below last.
 * This produces a "marketable limit" that fills immediately at the current price
 * while satisfying Schwab's requirement that extended-hours orders be LIMIT type.
 * lastPrice is required for extended-hours orders; if omitted the order falls
 * back to MARKET/NORMAL (which Schwab will reject if the market is closed).
 */
export async function placeAutoEquityOrder(
  accountHash: string,
  symbol: string,
  instruction: EquityInstruction,
  quantity: number,
  lastPrice?: number,
): Promise<PlaceEquityResult> {
  const token = getTokens("trader")?.accessToken;
  if (!token) return { ok: false, orderId: null, error: "no_trader_token" };
  if (!accountHash) return { ok: false, orderId: null, error: "no_account" };
  if (!Number.isFinite(quantity) || quantity < 1) {
    return { ok: false, orderId: null, error: "invalid_quantity" };
  }

  const schwabSession = currentSchwabSession();
  const isExtended = schwabSession !== "NORMAL";

  // Schwab requires LIMIT orders for extended-hours sessions (AM/PM).
  // A marketable limit (1% buffer) behaves like a market order but satisfies the requirement.
  let orderType: string;
  let limitPrice: number | undefined;
  if (isExtended && lastPrice && Number.isFinite(lastPrice) && lastPrice > 0) {
    orderType = "LIMIT";
    limitPrice = instruction === "BUY"
      ? Math.round(lastPrice * 1.01 * 100) / 100  // 1% above last — ensures fill
      : Math.round(lastPrice * 0.99 * 100) / 100; // 1% below last — ensures fill
  } else {
    orderType = "MARKET";
  }

  const order: Record<string, unknown> = {
    orderType,
    session: schwabSession,
    duration: "DAY",
    orderStrategyType: "SINGLE",
    ...(limitPrice !== undefined && { price: limitPrice }),
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
      session: schwabSession,
      timestamp: Date.now(),
      raw: "auto-trader",
    });

    const sessionLabel = schwabSession === "AM" ? " (pre-market)" : schwabSession === "PM" ? " (after-hours)" : "";
    void sendPushToAll({
      title: "ALPHA AUTO-TRADER",
      body: `${instruction} ${quantity} ${symbol.toUpperCase()}${sessionLabel} placed`,
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
      logger.warn(
        { status: schwabRes.status, body: body.slice(0, 300), symbol: sym, trailPercent: roundedTrail },
        "autoTrade TRIGGER order rejected — falling back to plain MARKET BUY",
      );
      // Schwab rejected the TRIGGER (account permissions or symbol restriction).
      // Fall back to a plain MARKET BUY so the position still opens. The LLM
      // will handle the exit via SELL signal on the next cycle.
      const fallback = await placeAutoEquityOrder(accountHash, sym, "BUY", quantity);
      return { ...fallback, trailingStopPlaced: false };
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

    return { ok: true, orderId, trailingStopPlaced: true };
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
  /** Exit fill price for exit rows (TAKE_PROFIT / FLATTEN_CLOSE). */
  exitPrice?: number | null;
  /** Realized P&L for exit rows. */
  pnl?: number | null;
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
      exitPrice: input.exitPrice ?? null,
      pnl: input.pnl ?? null,
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
