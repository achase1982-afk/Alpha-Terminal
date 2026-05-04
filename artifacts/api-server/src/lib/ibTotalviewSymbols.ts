import type { IBSymbolDef } from "./ibBreadthSymbols.js";
import { LIQUID_CORE_SYMBOLS } from "../data/liquidCore130.js";

/** NASDAQ TotalView L2 depth — reqMktDepth on NASDAQ venue (not SMART). */
export const TOTALVIEW_REQ_ID_BASE = 13_000;

const nasdaqPrimary = LIQUID_CORE_SYMBOLS.filter((e) => e.primaryListing === "NASDAQ");

export const TOTALVIEW_SYMBOLS: IBSymbolDef[] = nasdaqPrimary.map((e, i) => ({
  reqId: TOTALVIEW_REQ_ID_BASE + i,
  symbol: e.symbol,
  ibSymbol: e.symbol,
  secType: "STK",
  exchange: "NASDAQ",
  displaySymbol: e.symbol,
  category: "NASDAQ_TOTALVIEW",
  description: "NASDAQ TotalView L2 depth (5 rows)",
  enabled: true,
}));

export const TOTALVIEW_REQID_TO_SYMBOL = new Map<number, string>(
  TOTALVIEW_SYMBOLS.map((d) => [d.reqId, d.displaySymbol]),
);

export const NASDAQ_PRIMARY_LIQUID_CORE_COUNT = nasdaqPrimary.length;
