import { logger } from "./logger.js";

const POLYGON_API = "https://api.polygon.io";

/**
 * Reference ticker market cap (USD) when Schwab fundamental.marketCap is absent.
 * Same source as universeBuilder enrichTickerDetails (Polygon /v3/reference/tickers).
 */
export async function fetchPolygonTickerMarketCapUsd(ticker: string): Promise<number | null> {
  const key = process.env["POLYGON_API_KEY"];
  const sym = ticker.toUpperCase().trim().replace(/^\$/, "");
  if (!key || !sym) return null;
  try {
    const url =
      `${POLYGON_API}/v3/reference/tickers/${encodeURIComponent(sym)}?apiKey=${encodeURIComponent(key)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { results?: { market_cap?: number } };
    const cap = json.results?.market_cap;
    if (typeof cap !== "number" || !Number.isFinite(cap) || cap <= 0) return null;
    return cap;
  } catch {
    return null;
  }
}

export function logMarketCapPolygonFallback(ticker: string): void {
  logger.info({ ticker, source: "polygon_fallback" }, "marketCap fell back to Polygon");
}
