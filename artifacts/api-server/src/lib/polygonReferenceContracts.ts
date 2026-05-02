import { logger } from "./logger";

const POLYGON_API = "https://api.polygon.io";
export const REFERENCE_CONTRACT_CACHE_MS = 4 * 60 * 60 * 1000;
const REFERENCE_MAX_PAGES = 500;

type RefCache = { fetchedAt: number; contractCount: number; distinctExpirationCount: number };

const referenceContractStatsCache = new Map<string, RefCache>();

export interface PolygonReferenceStats {
  contractCount: number;
  distinctExpirationCount: number;
}

/**
 * Paginate Polygon reference options contracts for an underlying (active only).
 * Caches contract count and distinct expiration count for 4 hours per symbol (one pagination pass).
 */
export async function fetchPolygonReferenceStats(symbol: string, apiKey: string): Promise<PolygonReferenceStats | null> {
  const upper = symbol.toUpperCase();
  const cached = referenceContractStatsCache.get(upper);
  if (cached && Date.now() - cached.fetchedAt < REFERENCE_CONTRACT_CACHE_MS) {
    return {
      contractCount: cached.contractCount,
      distinctExpirationCount: cached.distinctExpirationCount,
    };
  }

  let total = 0;
  const expirations = new Set<string>();
  let pages = 0;
  let nextUrl: string | null =
    `${POLYGON_API}/v3/reference/options/contracts?underlying_ticker=${encodeURIComponent(upper)}&limit=1000&expired=false&sort=expiration_date&order=asc&apiKey=${encodeURIComponent(apiKey)}`;

  try {
    while (nextUrl && pages < REFERENCE_MAX_PAGES) {
      const fetchUrl = nextUrl.includes("apiKey=") ? nextUrl : `${nextUrl}&apiKey=${encodeURIComponent(apiKey)}`;
      const resp = await fetch(fetchUrl, { signal: AbortSignal.timeout(45_000) });
      if (!resp.ok) {
        logger.warn({ symbol: upper, status: resp.status }, "Polygon reference contracts HTTP non-OK");
        return null;
      }
      const json = (await resp.json()) as {
        results?: Array<{ contract_type?: string; expiration_date?: string }>;
        next_url?: string | null;
        status?: string;
      };
      if (json.status === "ERROR" || !json.results?.length) break;
      for (const c of json.results) {
        const t = c.contract_type;
        if (t !== "call" && t !== "put") continue;
        total++;
        const e = c.expiration_date;
        if (e) expirations.add(String(e).slice(0, 10));
      }
      pages++;
      nextUrl = json.next_url ?? null;
    }
    if (nextUrl && pages >= REFERENCE_MAX_PAGES) {
      logger.warn({ symbol: upper, pages }, "Polygon reference contracts pagination cap reached");
    }
  } catch (err) {
    logger.warn({ err, symbol: upper }, "Polygon reference contracts fetch failed");
    return null;
  }

  const stats: PolygonReferenceStats = {
    contractCount: total,
    distinctExpirationCount: expirations.size,
  };
  referenceContractStatsCache.set(upper, {
    fetchedAt: Date.now(),
    contractCount: stats.contractCount,
    distinctExpirationCount: stats.distinctExpirationCount,
  });
  return stats;
}

export async function fetchPolygonReferenceContractCount(symbol: string, apiKey: string): Promise<number | null> {
  const s = await fetchPolygonReferenceStats(symbol, apiKey);
  return s?.contractCount ?? null;
}
