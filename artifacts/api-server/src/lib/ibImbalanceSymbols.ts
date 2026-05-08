import type { IBSymbolDef } from "./ibBreadthSymbols.js";
import { LIQUID_CORE_SYMBOLS } from "../data/liquidCore130.js";
import { getNyseListedTuningSymbols } from "./tuningUniverseRegistrar.js";

/**
 * Dedicated reqId pool for NYSE closing auction imbalance (generic tick 225).
 * Must not overlap breadth (~5000–5120), depth (6000–6099), dynamic depth (6500+),
 * dynamic on-demand quotes (7000+, MAX 95 slots), or tuning L1 (16000–16031).
 */
export const IMBALANCE_REQ_ID_BASE = 12_000;

/** Reserved span for imbalance reqIds (stable Map allocation below). */
export const IMBALANCE_REQ_ID_RESERVED = 128;

const nyseLc = LIQUID_CORE_SYMBOLS.filter((e) => e.primaryListing === "NYSE").map((e) => e.symbol.toUpperCase());
const nyseTuning = [...getNyseListedTuningSymbols()];
const nyseMerged = [...new Set([...nyseLc, ...nyseTuning])].sort();

if (nyseMerged.length > IMBALANCE_REQ_ID_RESERVED) {
  throw new Error(
    `ibImbalanceSymbols: NYSE union exceeds ${IMBALANCE_REQ_ID_RESERVED} (${nyseMerged.length}). Raise reserved span or split pools.`,
  );
}

export const IMBALANCE_SYMBOLS: IBSymbolDef[] = nyseMerged.map((symbol, i) => ({
  reqId: IMBALANCE_REQ_ID_BASE + i,
  symbol,
  ibSymbol: symbol,
  secType: "STK",
  exchange: "NYSE",
  displaySymbol: symbol,
  category: "NYSE_IMBALANCE",
  description: `NYSE closing auction imbalance stream (generic tick 225)`,
  enabled: true,
}));

export const IMBALANCE_REQID_TO_SYMBOL = new Map<number, string>(
  IMBALANCE_SYMBOLS.map((d) => [d.reqId, d.displaySymbol]),
);

export const NYSE_PRIMARY_LIQUID_CORE_COUNT = nyseLc.length;
export const NYSE_IMBALANCE_UNION_COUNT = nyseMerged.length;
