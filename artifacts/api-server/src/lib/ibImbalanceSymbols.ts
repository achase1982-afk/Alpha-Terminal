import type { IBSymbolDef } from "./ibBreadthSymbols.js";
import { LIQUID_CORE_SYMBOLS } from "../data/liquidCore130.js";
import { TUNING_UNIVERSE } from "../data/tuningUniverse.js";

/**
 * Dedicated reqId pool for NYSE closing auction imbalance (generic tick 225).
 * Must not overlap breadth (~5000–5120), depth (6000–6099), dynamic depth (6500+),
 * dynamic on-demand quotes (7000+, MAX 95 slots), or tuning L1 (16000–16031).
 */
export const IMBALANCE_REQ_ID_BASE = 12_000;

/** Reserved span for stable symbol→reqId mapping within [BASE, BASE + SPAN). */
export const IMBALANCE_REQ_ID_SPAN = 128;

function nyseLiquidCoreSymbols(): string[] {
  return LIQUID_CORE_SYMBOLS.filter((e) => e.primaryListing === "NYSE").map((e) => e.symbol);
}

function nyseTuningSymbols(): string[] {
  return TUNING_UNIVERSE.filter((e) => e.primaryListing === "NYSE").map((e) => e.symbol);
}

function imbalanceUnionSorted(): string[] {
  const set = new Set<string>([...nyseLiquidCoreSymbols(), ...nyseTuningSymbols()]);
  return [...set].sort((a, b) => a.localeCompare(b));
}

const sortedUnion = imbalanceUnionSorted();

if (sortedUnion.length > IMBALANCE_REQ_ID_SPAN) {
  throw new Error(
    `ibImbalanceSymbols: NYSE imbalance union (${sortedUnion.length}) exceeds reserved reqId span ${IMBALANCE_REQ_ID_SPAN}`,
  );
}

/** Stable reqId = BASE + index in sorted union of LC130-NYSE and tuning-NYSE. */
export const IMBALANCE_SYMBOLS: IBSymbolDef[] = sortedUnion.map((sym, i) => ({
  reqId: IMBALANCE_REQ_ID_BASE + i,
  symbol: sym,
  ibSymbol: sym,
  secType: "STK",
  exchange: "NYSE",
  displaySymbol: sym,
  category: "NYSE_IMBALANCE",
  description: `NYSE closing auction imbalance stream (generic tick 225)`,
  enabled: true,
}));

export const IMBALANCE_REQID_TO_SYMBOL = new Map<number, string>(
  IMBALANCE_SYMBOLS.map((d) => [d.reqId, d.displaySymbol]),
);

export const NYSE_PRIMARY_LIQUID_CORE_COUNT = nyseLiquidCoreSymbols().length;
