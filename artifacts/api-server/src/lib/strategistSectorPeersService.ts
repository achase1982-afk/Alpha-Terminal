import { fetchFmpCompanyProfile } from "./movers/fmpCompanyProfile.js";
import { getFmpApiKeyOrThrow, getFmpStockPeers } from "./fmpClient.js";
import { logger } from "./logger.js";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 6;
const PEER_CANDIDATE_LIMIT = 24;
const SCREENER_LIMIT = 300;

/** Names that move on BTC/crypto — not sympathy for enterprise hardware. */
const CRYPTO_PROXY_TICKERS = new Set(["MSTR", "COIN", "MARA", "RIOT", "CLSK", "HUT", "BITF"]);

type CacheEntry = { ts: number; peers: string[]; sector: string | null; industry: string | null };
const cache = new Map<string, CacheEntry>();

function normIndustryKey(industry: string | null | undefined): string | null {
  const s = industry?.trim().toLowerCase();
  return s && s.length > 0 ? s : null;
}

function displayIndustry(industry: string | null | undefined): string | null {
  const s = industry?.trim();
  return s && s.length > 0 ? s : null;
}

function isCryptoProxy(sym: string): boolean {
  return CRYPTO_PROXY_TICKERS.has(sym.toUpperCase());
}

async function fetchSameIndustryFromScreener(
  industry: string,
  exclude: string,
  limit: number,
): Promise<string[]> {
  let apiKey: string;
  try {
    apiKey = getFmpApiKeyOrThrow();
  } catch {
    return [];
  }

  try {
    const params = new URLSearchParams({
      sector: "Technology",
      country: "US",
      limit: String(SCREENER_LIMIT),
      apikey: apiKey,
    });
    const url = `https://financialmodelingprep.com/api/v3/stock-screener?${params.toString()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];

    const rows = (await res.json()) as Array<{ symbol?: string; industry?: string; marketCap?: number }>;
    if (!Array.isArray(rows)) return [];

    return rows
      .filter(
        (r) =>
          typeof r.symbol === "string"
          && r.symbol.toUpperCase() !== exclude
          && normIndustryKey(r.industry) === industry
          && !isCryptoProxy(r.symbol),
      )
      .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
      .slice(0, limit)
      .map((r) => r.symbol!.toUpperCase());
  } catch (err) {
    logger.warn({ err, industry }, "strategistSectorPeers: screener industry fallback failed");
    return [];
  }
}

async function filterPeersByIndustry(
  subject: string,
  candidates: string[],
  subjectIndustry: string | null,
  limit: number,
): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>([subject]);

  const add = (sym: string) => {
    const u = sym.toUpperCase();
    if (seen.has(u) || isCryptoProxy(u)) return;
    seen.add(u);
    out.push(u);
  };

  if (subjectIndustry) {
    for (const sym of candidates) {
      if (out.length >= limit) break;
      const prof = await fetchFmpCompanyProfile(sym);
      if (prof && normIndustryKey(prof.industry) === subjectIndustry) {
        add(sym);
      }
    }
    if (out.length < limit) {
      const screened = await fetchSameIndustryFromScreener(subjectIndustry, subject, limit * 2);
      for (const sym of screened) {
        if (out.length >= limit) break;
        add(sym);
      }
    }
    return out.slice(0, limit);
  }

  for (const sym of candidates) {
    if (out.length >= limit) break;
    if (!isCryptoProxy(sym)) add(sym);
  }
  return out.slice(0, limit);
}

export type StrategistSympathyContext = {
  peers: string[];
  sector: string | null;
  industry: string | null;
};

/**
 * Sympathy peers: FMP stock-peers filtered to the same FMP industry (excludes MSTR-style crypto proxies on hardware names).
 */
export async function fetchStrategistSympathyContext(
  ticker: string,
  limit = DEFAULT_LIMIT,
): Promise<StrategistSympathyContext> {
  const sym = (ticker || "").toUpperCase().trim().replace(/^\$/, "");
  if (!sym) return { peers: [], sector: null, industry: null };

  const cached = cache.get(sym);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return {
      peers: cached.peers.slice(0, limit),
      sector: cached.sector,
      industry: cached.industry,
    };
  }

  try {
    const subjectProfile = await fetchFmpCompanyProfile(sym);
    const subjectIndustry = normIndustryKey(subjectProfile?.industry ?? null);
    const subjectSector = displayIndustry(subjectProfile?.sector ?? null);
    const subjectIndustryDisplay = displayIndustry(subjectProfile?.industry ?? null);
    const candidates = await getFmpStockPeers(sym, PEER_CANDIDATE_LIMIT);
    const peers = await filterPeersByIndustry(sym, candidates, subjectIndustry, limit);
    cache.set(sym, {
      ts: Date.now(),
      peers,
      sector: subjectSector,
      industry: subjectIndustryDisplay,
    });
    return { peers, sector: subjectSector, industry: subjectIndustryDisplay };
  } catch (err) {
    logger.warn({ err, ticker: sym }, "strategistSectorPeers: fetch failed");
    return { peers: [], sector: null, industry: null };
  }
}

export async function fetchStrategistSympathyPeers(ticker: string, limit = DEFAULT_LIMIT): Promise<string[]> {
  const ctx = await fetchStrategistSympathyContext(ticker, limit);
  return ctx.peers;
}

export function clearStrategistSympathyPeersCache(symbol?: string): void {
  if (symbol) {
    cache.delete(symbol.toUpperCase().trim().replace(/^\$/, ""));
  } else {
    cache.clear();
  }
}
