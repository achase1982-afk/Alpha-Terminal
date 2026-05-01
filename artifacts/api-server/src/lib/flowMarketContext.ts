/**
 * Market-cap tiering and ETF classification for options flow persistence
 * (Items 2, 4, 26).
 */

const INDEX_ETFS = new Set(["SPY", "QQQ", "IWM", "DIA"]);
const SECTOR_ETFS = new Set([
  "XLF", "XLE", "XLK", "XLV", "XLI", "XLC", "XLY", "XLP", "XLU", "XLRE", "XLB",
]);

export type MarketCapTier =
  | "mega"
  | "large"
  | "mid"
  | "small"
  | "micro"
  | "etf_index"
  | "etf_sector"
  | "etf_niche"
  | "unknown";

export interface MarketContextSnapshot {
  marketCapUsd: number | null;
  tier: MarketCapTier;
  /** Notional USD threshold for "large print" persistence gate. */
  largeNotionalThresholdUsd: number;
  assetType: string | null;
  isEtf: boolean;
  /** True if market cap is within 10% of next tier boundary (stocks only). */
  tierBoundaryProximity: boolean;
}

function tierFromMarketCap(cap: number): Exclude<MarketCapTier, "etf_index" | "etf_sector" | "etf_niche" | "unknown"> {
  if (cap >= 500e9) return "mega";
  if (cap >= 100e9) return "large";
  if (cap >= 10e9) return "mid";
  if (cap >= 2e9) return "small";
  return "micro";
}

function thresholdForStockTier(t: Exclude<MarketCapTier, "etf_index" | "etf_sector" | "etf_niche" | "unknown">): number {
  switch (t) {
    case "mega":
      return 100_000;
    case "large":
      return 50_000;
    case "mid":
      return 25_000;
    case "small":
      return 10_000;
    default:
      return 5_000;
  }
}

function etfThreshold(sym: string): { tier: MarketCapTier; threshold: number } {
  const u = sym.toUpperCase();
  if (INDEX_ETFS.has(u)) return { tier: "etf_index", threshold: 250_000 };
  if (SECTOR_ETFS.has(u)) return { tier: "etf_sector", threshold: 100_000 };
  return { tier: "etf_niche", threshold: 50_000 };
}

/** Within 10% of crossing to adjacent tier (by cap). */
export function computeTierBoundaryProximity(cap: number, tier: MarketCapTier): boolean {
  if (!Number.isFinite(cap) || cap <= 0) return false;
  if (tier === "etf_index" || tier === "etf_sector" || tier === "etf_niche" || tier === "unknown") return false;
  const boundaries = [500e9, 100e9, 10e9, 2e9];
  for (const b of boundaries) {
    if (cap >= b * 0.9 && cap <= b * 1.1) return true;
  }
  return false;
}

export function buildMarketContextSnapshot(args: {
  ticker: string;
  marketCapUsd: number | null;
  assetType: string | null;
}): MarketContextSnapshot {
  const sym = args.ticker.toUpperCase();
  const at = (args.assetType ?? "").toUpperCase();
  const isEtf = at.includes("ETF") || at === "ETN" || sym.endsWith("ETF");

  if (isEtf) {
    const { tier, threshold } = etfThreshold(sym);
    return {
      marketCapUsd: args.marketCapUsd,
      tier,
      largeNotionalThresholdUsd: threshold,
      assetType: args.assetType,
      isEtf: true,
      tierBoundaryProximity: false,
    };
  }

  const cap = args.marketCapUsd;
  if (cap == null || !Number.isFinite(cap) || cap <= 0) {
    return {
      marketCapUsd: null,
      tier: "unknown",
      largeNotionalThresholdUsd: 100_000,
      assetType: args.assetType,
      isEtf: false,
      tierBoundaryProximity: false,
    };
  }

  const stockTier = tierFromMarketCap(cap);
  return {
    marketCapUsd: cap,
    tier: stockTier,
    largeNotionalThresholdUsd: thresholdForStockTier(stockTier),
    assetType: args.assetType,
    isEtf: false,
    tierBoundaryProximity: computeTierBoundaryProximity(cap, stockTier),
  };
}
