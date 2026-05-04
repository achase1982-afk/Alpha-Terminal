import type { IBSymbolDef } from "./ibBreadthSymbols.js";
import { LIQUID_CORE_SYMBOLS } from "../data/liquidCore130.js";

/**
 * Dedicated reqId pool for NYSE closing auction imbalance (generic tick 225).
 * Must not overlap breadth (~5000–5120), depth (6000–6099), dynamic depth (6500+),
 * or dynamic on-demand quotes (7000+, MAX 95 slots).
 */
export const IMBALANCE_REQ_ID_BASE = 12_000;

const nysePrimary = LIQUID_CORE_SYMBOLS.filter((e) => e.primaryListing === "NYSE");

export const IMBALANCE_SYMBOLS: IBSymbolDef[] = nysePrimary.map((e, i) => ({
  reqId: IMBALANCE_REQ_ID_BASE + i,
  symbol: e.symbol,
  ibSymbol: e.symbol,
  secType: "STK",
  exchange: "NYSE",
  displaySymbol: e.symbol,
  category: "NYSE_IMBALANCE",
  description: `NYSE closing auction imbalance stream (generic tick 225)`,
  enabled: true,
}));

export const IMBALANCE_REQID_TO_SYMBOL = new Map<number, string>(
  IMBALANCE_SYMBOLS.map((d) => [d.reqId, d.displaySymbol]),
);

export const NYSE_PRIMARY_LIQUID_CORE_COUNT = nysePrimary.length;
