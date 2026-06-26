/**
 * Schwab order execution (always live).
 *  - Momentum (active): TRIGGER BUY → resting protective STOP child, then a
 *    trailing stop the engine raises by cancel/replace each tick.
 *  - Legacy ORB: TRIGGER BUY → OCO (target + stop).
 *  - Exits: MARKET sell (take-profit / cut / time-stop).
 */
import { getTokens } from "../lib/tokenStore.js";
import { logger } from "../lib/logger.js";
import type { Signal, Config } from "./types.js";

const SCHWAB_TRADER_BASE = "https://api.schwabapi.com/trader/v1";

export interface BracketResult {
  ok: boolean;
  entryOrderId: string | null;
  error?: string;
}

/** Schwab order session for the current ET time, honoring the extended-hours toggle. */
export function currentSession(cfg: Config): { session: "NORMAL" | "AM" | "PM"; isExtended: boolean } {
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const mins = et.getHours() * 60 + et.getMinutes();
  if (cfg.enableExtendedHours) {
    if (mins >= 7 * 60 && mins < 9 * 60 + 30) return { session: "AM", isExtended: true };
    if (mins >= 16 * 60 && mins < 20 * 60) return { session: "PM", isExtended: true };
  }
  return { session: "NORMAL", isExtended: false };
}

function buildBracketOrder(signal: Signal, qty: number): Record<string, unknown> {
  const sym = signal.symbol.toUpperCase();
  const mkLeg = (instruction: string) => [
    { instruction, quantity: qty, instrument: { symbol: sym, assetType: "EQUITY" } },
  ];
  return {
    orderStrategyType: "TRIGGER",
    session: "NORMAL",
    duration: "DAY",
    orderType: "LIMIT",
    price: signal.entryPrice.toFixed(2),
    orderLegCollection: mkLeg("BUY"),
    childOrderStrategies: [
      {
        orderStrategyType: "OCO",
        childOrderStrategies: [
          {
            orderStrategyType: "SINGLE",
            session: "NORMAL",
            duration: "DAY",
            orderType: "LIMIT",
            price: signal.targetPrice.toFixed(2),
            orderLegCollection: mkLeg("SELL"),
          },
          {
            orderStrategyType: "SINGLE",
            session: "NORMAL",
            duration: "DAY",
            orderType: "STOP",
            stopPrice: signal.stopPrice.toFixed(2),
            orderLegCollection: mkLeg("SELL"),
          },
        ],
      },
    ],
  };
}

export async function placeBracket(signal: Signal, cfg: Config): Promise<BracketResult> {
  const order = buildBracketOrder(signal, signal.size);

  const token = getTokens("trader")?.accessToken;
  if (!token)   return { ok: false, entryOrderId: null, error: "no_trader_token" };
  if (!cfg.accountHash) return { ok: false, entryOrderId: null, error: "no_account_hash" };

  try {
    const res = await fetch(`${SCHWAB_TRADER_BASE}/accounts/${cfg.accountHash}/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(order),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.error({ status: res.status, body: body.slice(0, 300), symbol: signal.symbol }, "[engine] bracket order rejected");
      return { ok: false, entryOrderId: null, error: body.slice(0, 200) || `http_${res.status}` };
    }

    const location = res.headers.get("location") ?? "";
    const match = location.match(/orders\/(\d+)/);
    const entryOrderId = match?.[1] ?? null;

    logger.info(
      { symbol: signal.symbol, entryOrderId, entry: signal.entryPrice, stop: signal.stopPrice, target: signal.targetPrice },
      "[engine:live] bracket order placed",
    );
    return { ok: true, entryOrderId };
  } catch (err) {
    logger.error({ err, symbol: signal.symbol }, "[engine] bracket order error");
    return { ok: false, entryOrderId: null, error: "network_error" };
  }
}

export interface EntryWithStopResult {
  ok: boolean;
  entryOrderId: string | null;
  error?: string;
}

/**
 * Place a momentum/LLM entry: a BUY that, once filled, triggers a resting
 * protective STOP sell at `stopPrice`. Used by both engines (long stock only).
 *
 * Extended hours (when enabled and in the AM/PM window): a marketable LIMIT buy
 * (+1% buffer) in the matching session — Schwab requires LIMIT outside RTH.
 * Regular hours: a MARKET buy. The protective STOP child rests for NORMAL
 * session (stops don't run in extended hours).
 */
export async function placeEntryWithStop(
  symbol: string,
  qty: number,
  entryPrice: number,
  stopPrice: number,
  cfg: Config,
): Promise<EntryWithStopResult> {
  const token = getTokens("trader")?.accessToken;
  if (!token) return { ok: false, entryOrderId: null, error: "no_trader_token" };
  if (!cfg.accountHash) return { ok: false, entryOrderId: null, error: "no_account_hash" };
  if (!(qty >= 1)) return { ok: false, entryOrderId: null, error: "invalid_quantity" };

  const sym = symbol.toUpperCase();
  const { session, isExtended } = currentSession(cfg);
  const mkLeg = (instruction: string) => [
    { instruction, quantity: qty, instrument: { symbol: sym, assetType: "EQUITY" } },
  ];

  const entryLeg: Record<string, unknown> =
    isExtended && entryPrice > 0
      ? { orderType: "LIMIT", price: (Math.round(entryPrice * 1.01 * 100) / 100).toFixed(2), session }
      : { orderType: "MARKET", session: "NORMAL" };

  const order = {
    orderStrategyType: "TRIGGER",
    duration: "DAY",
    ...entryLeg,
    orderLegCollection: mkLeg("BUY"),
    childOrderStrategies: [
      {
        orderStrategyType: "SINGLE",
        session: "NORMAL",
        duration: "DAY",
        orderType: "STOP",
        stopPrice: stopPrice.toFixed(2),
        orderLegCollection: mkLeg("SELL"),
      },
    ],
  };

  try {
    const res = await fetch(`${SCHWAB_TRADER_BASE}/accounts/${cfg.accountHash}/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(order),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.error({ status: res.status, body: body.slice(0, 300), symbol: sym }, "[engine] entry+stop rejected");
      return { ok: false, entryOrderId: null, error: body.slice(0, 200) || `http_${res.status}` };
    }
    const entryOrderId = (res.headers.get("location") ?? "").match(/orders\/(\d+)/)?.[1] ?? null;
    logger.info({ symbol: sym, entryOrderId, entryPrice, stopPrice, session }, "[engine:live] entry+stop placed");
    return { ok: true, entryOrderId };
  } catch (err) {
    logger.error({ err, symbol: sym }, "[engine] entry+stop error");
    return { ok: false, entryOrderId: null, error: "network_error" };
  }
}

/** Place a standalone protective STOP sell (used to raise the trailing stop). */
export async function placeStopSell(
  symbol: string,
  qty: number,
  stopPrice: number,
  cfg: Config,
): Promise<{ ok: boolean; orderId: string | null }> {
  const token = getTokens("trader")?.accessToken;
  if (!token || !cfg.accountHash || !(qty >= 1)) return { ok: false, orderId: null };
  const order = {
    orderStrategyType: "SINGLE",
    session: "NORMAL",
    duration: "DAY",
    orderType: "STOP",
    stopPrice: stopPrice.toFixed(2),
    orderLegCollection: [
      { instruction: "SELL", quantity: qty, instrument: { symbol: symbol.toUpperCase(), assetType: "EQUITY" } },
    ],
  };
  try {
    const res = await fetch(`${SCHWAB_TRADER_BASE}/accounts/${cfg.accountHash}/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(order),
    });
    if (!res.ok) return { ok: false, orderId: null };
    const orderId = (res.headers.get("location") ?? "").match(/orders\/(\d+)/)?.[1] ?? null;
    return { ok: true, orderId };
  } catch {
    return { ok: false, orderId: null };
  }
}

/** Find the working protective STOP sell order id for a symbol (for trailing). */
export async function findWorkingStopOrderId(symbol: string, cfg: Config): Promise<string | null> {
  const token = getTokens("trader")?.accessToken;
  if (!token || !cfg.accountHash) return null;
  const sym = symbol.toUpperCase();
  const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const to = new Date(Date.now() + 60 * 1000).toISOString();
  const working = new Set(["WORKING", "PENDING_ACTIVATION", "QUEUED", "ACCEPTED", "AWAITING_PARENT_ORDER"]);
  try {
    const res = await fetch(
      `${SCHWAB_TRADER_BASE}/accounts/${cfg.accountHash}/orders?fromEnteredTime=${encodeURIComponent(from)}&toEnteredTime=${encodeURIComponent(to)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const orders = (await res.json()) as Array<{
      orderId?: number | string;
      status?: string;
      orderType?: string;
      orderLegCollection?: Array<{ instruction?: string; instrument?: { symbol?: string } }>;
    }>;
    for (const o of Array.isArray(orders) ? orders : []) {
      const leg = o.orderLegCollection?.[0];
      if (
        o.orderId != null &&
        (o.orderType === "STOP" || o.orderType === "TRAILING_STOP") &&
        leg?.instruction === "SELL" &&
        leg?.instrument?.symbol?.toUpperCase() === sym &&
        working.has(o.status ?? "")
      ) {
        return String(o.orderId);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Raise the protective stop: cancel the current working stop and place a new
 * STOP sell at the higher price. Returns the new stop order id (or null).
 */
export async function replaceTrailStop(
  symbol: string,
  qty: number,
  newStopPrice: number,
  currentStopOrderId: string | null,
  cfg: Config,
): Promise<string | null> {
  const stopId = currentStopOrderId ?? (await findWorkingStopOrderId(symbol, cfg));
  if (stopId) await cancelOrder(stopId, cfg);
  const placed = await placeStopSell(symbol, qty, newStopPrice, cfg);
  if (placed.ok) {
    logger.info({ symbol, newStopPrice, orderId: placed.orderId }, "[engine] trailing stop raised");
    return placed.orderId;
  }
  logger.warn({ symbol, newStopPrice }, "[engine] trailing stop replace failed — position may be unprotected");
  return null;
}

export async function cancelOrder(orderId: string, cfg: Config): Promise<boolean> {
  const token = getTokens("trader")?.accessToken;
  if (!token || !cfg.accountHash) return false;
  try {
    const res = await fetch(`${SCHWAB_TRADER_BASE}/accounts/${cfg.accountHash}/orders/${orderId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function flattenPosition(symbol: string, qty: number, cfg: Config): Promise<boolean> {
  const token = getTokens("trader")?.accessToken;
  if (!token || !cfg.accountHash) return false;
  try {
    const order = {
      orderStrategyType: "SINGLE",
      session: "NORMAL",
      duration: "DAY",
      orderType: "MARKET",
      orderLegCollection: [
        { instruction: "SELL", quantity: qty, instrument: { symbol: symbol.toUpperCase(), assetType: "EQUITY" } },
      ],
    };
    const res = await fetch(`${SCHWAB_TRADER_BASE}/accounts/${cfg.accountHash}/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(order),
    });
    logger.info({ symbol, qty, ok: res.ok }, "[engine] flatten order");
    return res.ok;
  } catch (err) {
    logger.error({ err, symbol }, "[engine] flatten order error");
    return false;
  }
}
