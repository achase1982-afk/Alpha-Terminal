import { logger } from "./logger";

// Tiered floors. Defensive sectors (XLP/XLU/XLV/XLRE) routinely print sub-10%
// 30-day IV in calm regimes — too aggressive a floor silently nulls valid data.
const BROAD_INDEX = new Set(["SPY", "QQQ", "DIA", "IWM", "VTI", "VOO"]);
const DEFENSIVE_SECTOR = new Set(["XLP", "XLU", "XLV", "XLRE"]);
const CYCLICAL_SECTOR = new Set(["XLE", "XLF", "XLK", "XLI", "XLY", "XLB", "XLC"]);

const HARD_CEILING = 5.0;

/** Levered / commodity ETFs treated like broad baskets for Path B sanity floors. */
const PATH_B_ETF_10_FLOOR = new Set<string>([
  ...BROAD_INDEX,
  "TQQQ",
  "GLD",
  "SLV",
  "USO",
  ...DEFENSIVE_SECTOR,
  ...CYCLICAL_SECTOR,
]);

export function ivFloorFor(symbol: string): number {
  const s = symbol.toUpperCase();
  if (BROAD_INDEX.has(s)) return 0.08;
  if (DEFENSIVE_SECTOR.has(s)) return 0.06;
  if (CYCLICAL_SECTOR.has(s)) return 0.10;
  return 0.05; // single names
}

export function validateIv30(
  symbol: string,
  iv: number | null | undefined,
  context?: string,
): number | null {
  if (iv == null || !Number.isFinite(iv)) return null;
  const sym = symbol.toUpperCase();
  const floor = ivFloorFor(sym);
  if (iv < floor || iv > HARD_CEILING) {
    logger.warn(
      { symbol: sym, iv, floor, context: context ?? "unspecified" },
      "ivSanityFloor: rejected suspicious IV",
    );
    return null;
  }
  return iv;
}

/**
 * Path B BSM backfill floors: 0.10 minimum for index-style / sector / commodity
 * ETFs; 0.05 for single names. Used when persisting BSM-derived iv_30d.
 */
export function ivFloorPathB(symbol: string): number {
  const s = symbol.toUpperCase();
  return PATH_B_ETF_10_FLOOR.has(s) ? 0.10 : 0.05;
}

export function validateIv30PathB(
  symbol: string,
  iv: number | null | undefined,
  context?: string,
): number | null {
  if (iv == null || !Number.isFinite(iv)) return null;
  const sym = symbol.toUpperCase();
  const floor = ivFloorPathB(sym);
  if (iv < floor || iv > HARD_CEILING) {
    logger.warn(
      { symbol: sym, iv, floor, context: context ?? "unspecified" },
      "ivSanityFloor: Path B rejected suspicious IV",
    );
    return null;
  }
  return iv;
}
