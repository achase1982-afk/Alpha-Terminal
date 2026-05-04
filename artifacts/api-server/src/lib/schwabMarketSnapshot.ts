import { fetchPolygonTickerMarketCapUsd, logMarketCapPolygonFallback } from "./polygonTickerMarketCap.js";
import { getBestAccessToken } from "./tokenStore.js";

const SCHWAB_API = "https://api.schwabapi.com/marketdata/v1";

export interface SchwabMarketSnapshot {
  marketCapUsd: number | null;
  assetType: string | null;
}

/**
 * One Schwab quotes call with reference + fundamental for market cap / asset type.
 * Used by options flow persistence and strategist package enrichment.
 */
export async function fetchSchwabMarketSnapshot(ticker: string): Promise<SchwabMarketSnapshot | null> {
  const token = getBestAccessToken();
  if (!token) return null;
  const sym = ticker.toUpperCase().trim();
  try {
    const res = await fetch(
      `${SCHWAB_API}/quotes?symbols=${encodeURIComponent(sym)}&fields=quote,fundamental,reference`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12_000) },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    const entry = (json[sym] ?? Object.values(json)[0]) as Record<string, unknown> | undefined;
    if (!entry) return null;
    const ref = entry["reference"] as Record<string, unknown> | undefined;
    const fund = entry["fundamental"] as Record<string, unknown> | undefined;
    const rawCap = fund?.["marketCap"];
    let marketCapUsd =
      typeof rawCap === "number" && Number.isFinite(rawCap) && rawCap > 0 ? rawCap : null;
    if (marketCapUsd == null) {
      const fromPoly = await fetchPolygonTickerMarketCapUsd(sym);
      if (fromPoly != null) {
        logMarketCapPolygonFallback(sym);
        marketCapUsd = fromPoly;
      }
    }
    const assetType =
      typeof ref?.["assetType"] === "string"
        ? ref.assetType
        : typeof ref?.["assetMainType"] === "string"
          ? String(ref.assetMainType)
          : null;
    return { marketCapUsd, assetType };
  } catch {
    return null;
  }
}
