/**
 * Schwab bracket / OCO order execution.
 * Shadow mode: logs everything, places nothing.
 * Live mode:   POST TRIGGER + OCO to Schwab Trader API.
 */
import { getTokens } from "../lib/tokenStore.js";
import { logger } from "../lib/logger.js";
import type { Signal, Config } from "./types.js";

const SCHWAB_TRADER_BASE = "https://api.schwabapi.com/trader/v1";

export interface BracketResult {
  ok: boolean;
  entryOrderId: string | null;
  error?: string;
  shadow: boolean;
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

  if (cfg.runMode !== "live") {
    logger.info(
      { symbol: signal.symbol, entry: signal.entryPrice, stop: signal.stopPrice, target: signal.targetPrice, size: signal.size },
      "[engine:shadow] bracket order NOT placed",
    );
    return { ok: true, entryOrderId: null, shadow: true };
  }

  const token = getTokens("trader")?.accessToken;
  if (!token)   return { ok: false, entryOrderId: null, error: "no_trader_token", shadow: false };
  if (!cfg.accountHash) return { ok: false, entryOrderId: null, error: "no_account_hash", shadow: false };

  try {
    const res = await fetch(`${SCHWAB_TRADER_BASE}/accounts/${cfg.accountHash}/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(order),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.error({ status: res.status, body: body.slice(0, 300), symbol: signal.symbol }, "[engine] bracket order rejected");
      return { ok: false, entryOrderId: null, error: body.slice(0, 200) || `http_${res.status}`, shadow: false };
    }

    const location = res.headers.get("location") ?? "";
    const match = location.match(/orders\/(\d+)/);
    const entryOrderId = match?.[1] ?? null;

    logger.info(
      { symbol: signal.symbol, entryOrderId, entry: signal.entryPrice, stop: signal.stopPrice, target: signal.targetPrice },
      "[engine:live] bracket order placed",
    );
    return { ok: true, entryOrderId, shadow: false };
  } catch (err) {
    logger.error({ err, symbol: signal.symbol }, "[engine] bracket order error");
    return { ok: false, entryOrderId: null, error: "network_error", shadow: false };
  }
}

export async function cancelOrder(orderId: string, cfg: Config): Promise<boolean> {
  if (cfg.runMode !== "live") return true;
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
  if (cfg.runMode !== "live") {
    logger.info({ symbol, qty }, "[engine:shadow] flatten NOT placed");
    return true;
  }
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
