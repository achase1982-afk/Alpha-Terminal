import type { IBSymbolDef } from "./ibBreadthSymbols.js";

/** Front-month ES futures depth on CME (native book, not SMART). */
export const ES_DEPTH_REQ_ID = 14_000;

export const ES_DEPTH_SYMBOL_DEF: IBSymbolDef = {
  reqId: ES_DEPTH_REQ_ID,
  symbol: "/ES",
  ibSymbol: "ES",
  secType: "FUT",
  exchange: "CME",
  displaySymbol: "__ES_DEPTH__",
  category: "ES_DEPTH",
  description: "E-mini S&P 500 front-month L2 depth",
  enabled: true,
};
