import { TUNING_SYMBOLS } from "../data/tuningUniverse.js";
import type { IBSymbolDef } from "./ibBreadthSymbols.js";

/** Permanent equity L1 pool for tuning universe (separate from BREADTH_SYMBOLS breadth loop). */
export const TUNING_L1_REQ_ID_BASE = 16_000;

const TUNING_L1_SPAN = 32;

function buildTuningL1Defs(): IBSymbolDef[] {
  const syms = [...TUNING_SYMBOLS].map((s) => s.toUpperCase()).sort((a, b) => a.localeCompare(b));
  if (syms.length > TUNING_L1_SPAN) {
    throw new Error(`ibTuningL1Symbols: tuning universe has ${syms.length} symbols; raise TUNING_L1_SPAN (${TUNING_L1_SPAN})`);
  }
  return syms.map((symbol, i) => ({
    reqId: TUNING_L1_REQ_ID_BASE + i,
    symbol,
    ibSymbol: symbol,
    secType: "STK",
    exchange: "SMART",
    displaySymbol: symbol,
    category: "TUNING_L1",
    description: "Permanent tuning-universe equity L1 (IBKR)",
    enabled: true,
  }));
}

export const TUNING_L1_SYMBOL_DEFS: IBSymbolDef[] = buildTuningL1Defs();
