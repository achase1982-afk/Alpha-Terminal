import { getFmpStockPeers } from "./fmpClient.js";
import { logger } from "./logger.js";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 6;

type CacheEntry = { ts: number; peers: string[] };
const cache = new Map<string, CacheEntry>();

/**
 * Sympathy / sector peers for full-report chips — FMP stock-peers by sector and market cap.
 */
export async function fetchStrategistSympathyPeers(ticker: string, limit = DEFAULT_LIMIT): Promise<string[]> {
  const sym = (ticker || "").toUpperCase().trim().replace(/^\$/, "");
  if (!sym) return [];

  const cached = cache.get(sym);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.peers.slice(0, limit);
  }

  try {
    const peers = await getFmpStockPeers(sym, limit);
    cache.set(sym, { ts: Date.now(), peers });
    return peers;
  } catch (err) {
    logger.warn({ err, ticker: sym }, "strategistSectorPeers: fetch failed");
    return [];
  }
}

export function clearStrategistSympathyPeersCache(symbol?: string): void {
  if (symbol) {
    cache.delete(symbol.toUpperCase().trim().replace(/^\$/, ""));
  } else {
    cache.clear();
  }
}
