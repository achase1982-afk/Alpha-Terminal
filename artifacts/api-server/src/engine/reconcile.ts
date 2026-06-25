/**
 * Broker reconciliation — makes Schwab the source of truth for engine state.
 *
 * The engine optimistically records a position the moment it places a bracket.
 * That picture is a guess until it's confirmed against the broker. This pass
 * pulls real open positions and recent orders from Schwab and forces the
 * engine's per-symbol
 * state to match reality — true entry price, true open quantity, and whether an
 * exit or a pending entry actually happened.
 *
 * Divergences handled (the cases that actually break things):
 *  - Partial fill: broker holds fewer shares than ordered → correct quantity.
 *  - Bracket exit filled mid-evaluation: broker shows flat while the engine
 *    still thinks it holds → record the exit, clear the position.
 *  - Rejected / canceled / expired entry: pending order will never fill →
 *    drop the optimistic position so the engine stops waiting on it.
 *  - Adopted position: broker holds shares the engine doesn't know about →
 *    take them on at the broker's average cost.
 *
 * Every divergence is logged loudly; the risk layer then acts on the corrected
 * state on the next tick.
 */
import { getTokens } from "../lib/tokenStore.js";
import { logger } from "../lib/logger.js";
import { fetchMappedSchwabAccounts } from "../lib/schwabPortfolioAccounts.js";
import { recordTrade } from "./risk.js";
import { logExit } from "./logger.js";
import { state, type SymbolState } from "./state.js";
import type { Config } from "./types.js";

const SCHWAB_TRADER_BASE = "https://api.schwabapi.com/trader/v1";
const AVG_PRICE_EPS = 0.01; // treat sub-cent average-price drift as noise

/** Broker truth for one symbol's open long position. */
export interface BrokerPosition {
  symbol: string;
  quantity: number;
  avgPrice: number;
}

/** Broker truth for one recent order. */
export interface BrokerOrder {
  orderId: string;
  symbol: string;
  status: string;
  filledQuantity: number;
}

const TERMINAL_UNFILLED = new Set(["REJECTED", "CANCELED", "EXPIRED", "REPLACED"]);

/** Record a reconciled exit (broker shows the position closed). */
function recordReconciledExit(s: SymbolState, exitPrice: number, cfg: Config): number {
  const pos = s.position!;
  const pnl = (exitPrice - pos.avgPrice) * pos.quantity; // long-only
  try {
    logExit({
      entryOrderId: s.pendingEntryOrderId ?? "live",
      exitOrderId: "reconciled",
      symbol: pos.symbol,
      entryPrice: pos.avgPrice,
      exitPrice,
      quantity: pos.quantity,
      pnl,
      exitReason: "RECONCILED",
      exitAt: new Date(),
    });
  } catch (err) {
    logger.warn({ err, symbol: s.symbol }, "[reconcile] logExit failed");
  }
  recordTrade(state.riskState, pos.symbol, pnl, cfg);
  s.position = null;
  s.pendingEntryOrderId = null;
  s.pendingEntryAt = null;
  s.pendingSignal = null;
  return pnl;
}

/**
 * Pure reconciliation: correct each per-symbol state against broker truth.
 * Mutates `state` in place and returns a human-readable list of corrections.
 */
export function applyReconciliation(
  brokerPositions: Map<string, BrokerPosition>,
  brokerOrders: Map<string, BrokerOrder>,
  cfg: Config,
): string[] {
  const corrections: string[] = [];

  for (const s of state.symbols.values()) {
    const sym = s.symbol.toUpperCase();
    const bp = brokerPositions.get(sym);
    const brokerQty = bp?.quantity ?? 0;

    // ── 1. Resolve a pending entry order against broker order status ──────────
    if (s.pendingEntryOrderId) {
      const ord = brokerOrders.get(s.pendingEntryOrderId);
      if (ord && TERMINAL_UNFILLED.has(ord.status) && ord.filledQuantity <= 0) {
        // Entry will never fill — drop the optimistic position.
        const msg = `${sym}: pending entry ${s.pendingEntryOrderId} ${ord.status} (unfilled) — clearing optimistic position`;
        corrections.push(msg);
        logger.warn({ symbol: sym, orderId: s.pendingEntryOrderId, status: ord.status }, `[reconcile] ${msg}`);
        s.position = null;
        s.pendingEntryOrderId = null;
        s.pendingEntryAt = null;
        s.pendingSignal = null;
      } else if (ord && (ord.status === "FILLED" || ord.filledQuantity > 0)) {
        // Confirmed (or partially) filled — stop tracking the pending order;
        // quantity/price are reconciled from the broker position below.
        s.pendingEntryOrderId = null;
        s.pendingEntryAt = null;
        s.pendingSignal = null;
      }
      // Still WORKING/PENDING/unknown → leave it; cancel-timeout handles staleness.
    }

    const pos = s.position;
    const engineQty = pos && !pos.isFlat ? pos.quantity : 0;

    // ── 2. Reconcile position vs broker ──────────────────────────────────────
    if (brokerQty <= 0 && engineQty > 0) {
      // Broker is flat but the engine thinks it holds — the exit already filled.
      const exitPrice = s.features.last || pos!.avgPrice;
      const pnl = recordReconciledExit(s, exitPrice, cfg);
      const msg = `${sym}: broker flat, engine held ${engineQty} — recorded exit @ ~${exitPrice.toFixed(2)} (pnl ${pnl.toFixed(2)})`;
      corrections.push(msg);
      logger.warn({ symbol: sym }, `[reconcile] ${msg}`);
    } else if (brokerQty > 0 && engineQty === 0) {
      // Broker holds shares the engine doesn't know about — adopt at broker cost.
      const stop = s.pendingSignal?.stopPrice ?? 0;
      const target = s.pendingSignal?.targetPrice ?? 0;
      s.position = {
        symbol: sym,
        quantity: brokerQty,
        avgPrice: bp!.avgPrice,
        stopPrice: stop,
        targetPrice: target,
        isFlat: false,
      };
      const msg = `${sym}: broker holds ${brokerQty} @ ${bp!.avgPrice.toFixed(2)}, engine flat — adopted${stop ? "" : " (no bracket levels known)"}`;
      corrections.push(msg);
      logger.warn({ symbol: sym, brokerQty, avgPrice: bp!.avgPrice }, `[reconcile] ${msg}`);
    } else if (brokerQty > 0 && engineQty > 0) {
      // Both hold — correct quantity (partial fill) and/or average price.
      if (brokerQty !== engineQty) {
        const msg = `${sym}: quantity mismatch engine ${engineQty} → broker ${brokerQty} (partial fill) — corrected`;
        corrections.push(msg);
        logger.warn({ symbol: sym, engineQty, brokerQty }, `[reconcile] ${msg}`);
        pos!.quantity = brokerQty;
      }
      if (Math.abs((pos!.avgPrice ?? 0) - bp!.avgPrice) > AVG_PRICE_EPS) {
        const msg = `${sym}: avg price engine ${pos!.avgPrice.toFixed(2)} → broker ${bp!.avgPrice.toFixed(2)} — corrected`;
        corrections.push(msg);
        logger.warn({ symbol: sym }, `[reconcile] ${msg}`);
        pos!.avgPrice = bp!.avgPrice;
      }
    }
  }

  return corrections;
}

// ── Schwab fetch helpers ───────────────────────────────────────────────────────

async function fetchBrokerPositions(accountHash: string, token: string): Promise<Map<string, BrokerPosition>> {
  const out = new Map<string, BrokerPosition>();
  const accounts = (await fetchMappedSchwabAccounts(token)) as Array<{
    hashValue: string | null;
    positions: Array<{ symbol: string; assetType: string; longQuantity: number; averagePrice: number }>;
  }>;
  const acct = accounts.find((a) => a.hashValue === accountHash) ?? accounts[0];
  if (!acct) return out;
  for (const p of acct.positions) {
    if (p.assetType !== "EQUITY" || p.longQuantity <= 0) continue;
    const sym = p.symbol.toUpperCase();
    out.set(sym, { symbol: sym, quantity: p.longQuantity, avgPrice: p.averagePrice });
  }
  return out;
}

async function fetchRecentOrders(accountHash: string, token: string): Promise<Map<string, BrokerOrder>> {
  const out = new Map<string, BrokerOrder>();
  const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const to = new Date(Date.now() + 60 * 1000).toISOString();
  const res = await fetch(
    `${SCHWAB_TRADER_BASE}/accounts/${accountHash}/orders?fromEnteredTime=${encodeURIComponent(from)}&toEnteredTime=${encodeURIComponent(to)}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) return out;
  const orders = (await res.json()) as Array<{
    orderId?: number | string;
    status?: string;
    filledQuantity?: number;
    orderLegCollection?: Array<{ instrument?: { symbol?: string } }>;
  }>;
  for (const o of Array.isArray(orders) ? orders : []) {
    if (o.orderId == null) continue;
    const sym = o.orderLegCollection?.[0]?.instrument?.symbol?.toUpperCase() ?? "";
    out.set(String(o.orderId), {
      orderId: String(o.orderId),
      symbol: sym,
      status: o.status ?? "UNKNOWN",
      filledQuantity: Number(o.filledQuantity ?? 0),
    });
  }
  return out;
}

let _reconciling = false;

/**
 * Fetch broker truth and reconcile engine state. Best-effort:
 * never throws into the hot loop.
 */
export async function reconcileAccount(cfg: Config): Promise<void> {
  if (_reconciling) return; // never overlap a reconcile with itself
  if (!cfg.accountHash) return;
  const token = getTokens("trader")?.accessToken;
  if (!token) return;

  _reconciling = true;
  try {
    const [positions, orders] = await Promise.all([
      fetchBrokerPositions(cfg.accountHash, token),
      fetchRecentOrders(cfg.accountHash, token),
    ]);
    const corrections = applyReconciliation(positions, orders, cfg);
    if (corrections.length) {
      logger.warn({ count: corrections.length }, "[reconcile] engine state corrected against broker");
    }
  } catch (err) {
    logger.error({ err }, "[reconcile] failed — engine state may be stale");
  } finally {
    _reconciling = false;
  }
}
