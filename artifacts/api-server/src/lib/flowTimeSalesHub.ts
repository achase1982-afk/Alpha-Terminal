import type { Response } from "express";
import { logger } from "./logger.js";
import {
  isEnabled as polygonWsEnabled,
  subscribeContractsWithQuotes,
  unsubscribeContractsWithQuotes,
  getNbbo,
  onTrade,
  type PolygonOptionTrade,
  type NbboSnapshot,
} from "./polygonOptionsWs.js";

// ── Live time-and-sales SSE multiplexer ──────────────────────────────
//
// Per OPRA contract we hold a Set of SSE response objects. The Polygon
// options WS shared instance ref-counts both the T (trade) and Q (quote)
// channel subscriptions, so independent clients can subscribe & disconnect
// without stepping on each other.
//
// On every incoming trade we:
//   1. Look up the cached NBBO snapshot (populated by Q events).
//   2. Run Lee-Ready aggressor inference (quote rule + tick rule fallback).
//   3. Tag block / sweep based on Polygon condition codes.
//   4. Fan out to every subscriber for that contract as an SSE `trade` event.
//
// SSE wire shape (one event per JSON object, separated by \n\n):
//   event: trade
//   data: { sym, price, size, ts, conditions, aggressor, nbbo, isBlock, isSweep }

// Polygon options condition codes (subset). These are OPRA conditions
// passed through by Polygon as the `c` array on each trade event.
//   152 — Intermarket Sweep Order (ISO)
//   153 — Single-leg auction sweep / cross (treat as sweep heuristic)
//   154 — Single-leg cross (treat as block heuristic — cross prints typically
//         indicate negotiated size off the lit book)
//     7 — Cross / "stopped stock" (legacy block indicator)
// Condition lists are tuned conservatively so we don't over-tag normal flow.
const SWEEP_CONDITIONS = new Set<number>([152, 153]);
const BLOCK_CONDITIONS = new Set<number>([7, 154]);

export interface TimeSalesEvent {
  sym: string;
  price: number;
  size: number;
  ts: number;
  conditions: number[];
  aggressor: "buy" | "sell" | "neutral";
  nbbo: { bid: number; ask: number; ts: number } | null;
  isBlock: boolean;
  isSweep: boolean;
}

interface SubscriberSet {
  responses: Set<Response>;
  // Per-contract memory of last trade price for Lee-Ready tick-rule fallback.
  lastTradePrice: number | null;
}

const subscribersByContract = new Map<string, SubscriberSet>();
let tradeUnsubscribe: (() => void) | null = null;

function ensureGlobalTradeListener(): void {
  if (tradeUnsubscribe) return;
  tradeUnsubscribe = onTrade((t: PolygonOptionTrade) => {
    const sub = subscribersByContract.get(t.sym);
    if (!sub || sub.responses.size === 0) return;
    const nbbo = getNbbo(t.sym) ?? null;
    const aggressor = classifyAggressor(t.price, nbbo, sub.lastTradePrice);
    sub.lastTradePrice = t.price;

    const isSweep = t.conditions.some((c) => SWEEP_CONDITIONS.has(c));
    const isBlock = t.conditions.some((c) => BLOCK_CONDITIONS.has(c));

    const evt: TimeSalesEvent = {
      sym: t.sym,
      price: t.price,
      size: t.size,
      ts: t.timestamp,
      conditions: t.conditions,
      aggressor,
      nbbo: nbbo ? { bid: nbbo.bid, ask: nbbo.ask, ts: nbbo.ts } : null,
      isBlock,
      isSweep,
    };

    const payload = `event: trade\ndata: ${JSON.stringify(evt)}\n\n`;
    for (const res of sub.responses) {
      try { res.write(payload); } catch { /* client disconnected */ }
    }
  });
}

/**
 * Lee-Ready aggressor classification:
 *   - If trade price > midpoint  → buyer-initiated.
 *   - If trade price < midpoint  → seller-initiated.
 *   - At-midpoint → tick-rule fallback (uptick=buy, downtick=sell).
 *   - No NBBO available → neutral. Honest: we don't pretend to know.
 */
function classifyAggressor(
  price: number,
  nbbo: NbboSnapshot | null,
  lastPrice: number | null,
): "buy" | "sell" | "neutral" {
  if (!nbbo) return "neutral";
  const mid = (nbbo.bid + nbbo.ask) / 2;
  const eps = 1e-9;
  if (price > mid + eps) return "buy";
  if (price < mid - eps) return "sell";
  // At midpoint — tick rule
  if (lastPrice == null) return "neutral";
  if (price > lastPrice + eps) return "buy";
  if (price < lastPrice - eps) return "sell";
  return "neutral";
}

/**
 * Subscribe an SSE response to live trades for a contract. Bumps the
 * paired T+Q ref counts on the shared Polygon WS so quotes start flowing
 * (and the NBBO cache fills). Returns an unsubscribe fn.
 */
export async function subscribeSseClient(contract: string, res: Response): Promise<() => void> {
  if (!polygonWsEnabled()) {
    throw new Error("Polygon options WS is disabled (POLYGON_OPTIONS_WS_ENABLED!=1)");
  }
  ensureGlobalTradeListener();

  const sym = contract.startsWith("O:") ? contract : `O:${contract}`;
  let bucket = subscribersByContract.get(sym);
  if (!bucket) {
    bucket = { responses: new Set(), lastTradePrice: null };
    subscribersByContract.set(sym, bucket);
  }
  bucket.responses.add(res);

  try {
    await subscribeContractsWithQuotes([sym]);
  } catch (err) {
    bucket.responses.delete(res);
    if (bucket.responses.size === 0) subscribersByContract.delete(sym);
    throw err;
  }

  logger.info({ contract: sym, subscribers: bucket.responses.size }, "flowTimeSales: client subscribed");

  return () => {
    const b = subscribersByContract.get(sym);
    if (!b) return;
    b.responses.delete(res);
    if (b.responses.size === 0) {
      subscribersByContract.delete(sym);
    }
    try { unsubscribeContractsWithQuotes([sym]); } catch { /* best effort */ }
    logger.info({ contract: sym, remaining: b.responses.size }, "flowTimeSales: client unsubscribed");
  };
}

export function getHubStatus(): { contracts: number; totalSubscribers: number } {
  let total = 0;
  for (const b of subscribersByContract.values()) total += b.responses.size;
  return { contracts: subscribersByContract.size, totalSubscribers: total };
}

export { SWEEP_CONDITIONS, BLOCK_CONDITIONS };
