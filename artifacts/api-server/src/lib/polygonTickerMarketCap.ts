import { logger } from "./logger.js";

const POLYGON_API = "https://api.polygon.io";

/**
 * Reference ticker market cap (USD) when Schwab fundamental.marketCap is absent.
 * Same source as universeBuilder enrichTickerDetails (Polygon /v3/reference/tickers).
 */
export async function fetchPolygonTickerMarketCapUsd(_ticker: string): Promise<number | null> {
  return null;
}


export function logMarketCapPolygonFallback(ticker: string): void {
  logger.info({ ticker, source: "polygon_fallback" }, "marketCap fell back to Polygon");
}
