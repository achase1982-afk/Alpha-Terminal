import { logger } from "./logger";

// Tiered floors. Defensive sectors (XLP/XLU/XLV/XLRE) routinely print sub-10%
// 30-day IV in calm regimes — too aggressive a floor silently nulls valid data.
const BROAD_INDEX = new Set(["SPY", "QQQ", "DIA", "IWM", "VTI", "VOO"]);
const DEFENSIVE_SECTOR = new Set(["XLP", "XLU", "XLV", "XLRE"]);
const CYCLICAL_SECTOR = new Set(["XLE", "XLF", "XLK", "XLI", "XLY", "XLB", "XLC"]);

const HARD_CEILING = 5.0;

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
