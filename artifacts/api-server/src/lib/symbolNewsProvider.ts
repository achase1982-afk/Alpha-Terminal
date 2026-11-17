/**
 * Symbol news providers.
 *
 * Finnhub company-news (FINNHUB_API_KEY) is the active source. Alpaca's
 * Benzinga wire stays in this file but does not run unless both
 * ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY are set, and only after
 * Finnhub returns nothing. Neither path throws: callers get [].
 *
 * Polygon and the direct Benzinga news API are not used here.
 * To promote Alpaca later, move `alpacaProvider` ahead of `finnhubProvider`.
 */

import type { NormalizedArticle } from "./tickerNewsAggregated.js";

export interface SymbolNewsLog {
  warn: (o: unknown, m?: string) => void;
  info: (o: unknown, m?: string) => void;
}

export interface SymbolNewsProvider {
  readonly id: "alpaca" | "finnhub";
  fetch(symbol: string, log: SymbolNewsLog, signal?: AbortSignal): Promise<NormalizedArticle[]>;
}

const ALPACA_NEWS_URL = "https://data.alpaca.markets/v1beta1/news";

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}

/** Alpaca news is equity-ticker based. Indexes and futures roots are best-effort. */
export function alpacaNewsSymbol(symbol: string): string {
  const raw = symbol.trim().toUpperCase();
  if (!raw) return "";
  if (raw.startsWith("$")) {
    const indexMap: Record<string, string> = {
      $SPX: "SPY",
      $NDX: "QQQ",
      $DJI: "DIA",
      $RUT: "IWM",
      $VIX: "VIX",
    };
    return indexMap[raw] ?? raw.replace(/^\$/, "");
  }
  if (raw.startsWith("/")) {
    return raw.replace(/^\//, "").replace(/[FGHJKMNQUVXZ]\d{1,2}$/, "");
  }
  return raw;
}

interface AlpacaNewsItem {
  id?: number;
  headline?: string;
  summary?: string;
  author?: string;
  created_at?: string;
  url?: string;
  symbols?: string[];
  source?: string;
  images?: Array<{ url?: string; size?: string }>;
}

export async function fetchAlpacaNews(
  symbol: string,
  keyId: string,
  secret: string,
  log: SymbolNewsLog,
  signal?: AbortSignal,
): Promise<NormalizedArticle[]> {
  const ticker = alpacaNewsSymbol(symbol);
  if (!ticker || !keyId || !secret) return [];
  const url = `${ALPACA_NEWS_URL}?symbols=${encodeURIComponent(ticker)}&limit=50&sort=desc`;
  try {
    const response = await fetch(url, {
      headers: {
        "APCA-API-KEY-ID": keyId,
        "APCA-API-SECRET-KEY": secret,
        Accept: "application/json",
      },
      signal: signal ?? AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      log.warn({ status: response.status, symbol: ticker }, "Alpaca news API error");
      return [];
    }
    const data = (await response.json()) as { news?: AlpacaNewsItem[] };
    const rows = Array.isArray(data.news) ? data.news : [];
    log.info({ symbol: ticker, count: rows.length, provider: "alpaca" }, "Alpaca news fetched");
    return rows.map((a) => {
      const image =
        a.images?.find((img) => img.size === "large" && img.url)?.url ||
        a.images?.find((img) => img.url)?.url ||
        "";
      const created = a.created_at ? Math.floor(new Date(a.created_at).getTime() / 1000) : Math.floor(Date.now() / 1000);
      const idSource = String(a.id ?? a.url ?? a.headline ?? ticker);
      return {
        id: Math.abs(typeof a.id === "number" ? a.id : hashString(idSource)),
        source: (a.source || "ALPACA").toUpperCase(),
        headline: a.headline || "",
        summary: (a.summary || "").slice(0, 300),
        url: a.url || "",
        image,
        datetime: Number.isFinite(created) ? created : Math.floor(Date.now() / 1000),
        related: a.symbols?.[0] || ticker,
      };
    }).filter((a) => a.headline.length > 0);
  } catch (err) {
    log.warn({ err, symbol: ticker }, "Alpaca news fetch failed");
    return [];
  }
}

const alpacaProvider: SymbolNewsProvider = {
  id: "alpaca",
  async fetch(symbol, log, signal) {
    const keyId = (process.env["ALPACA_API_KEY_ID"] ?? "").trim();
    const secret = (process.env["ALPACA_API_SECRET_KEY"] ?? "").trim();
    if (!keyId || !secret) return [];
    return fetchAlpacaNews(symbol, keyId, secret, log, signal);
  },
};

const finnhubProvider: SymbolNewsProvider = {
  id: "finnhub",
  async fetch(symbol, log, signal) {
    const key = (process.env["FINNHUB_API_KEY"] ?? "").trim();
    if (!key) return [];
    const { fetchFinnhubNews } = await import("./tickerNewsAggregated.js");
    const clean = alpacaNewsSymbol(symbol);
    if (!clean) return [];
    return fetchFinnhubNews(clean, key, log, signal);
  },
};

/**
 * Finnhub is active. Alpaca is last and no-ops until ALPACA_API_KEY_ID and
 * ALPACA_API_SECRET_KEY are both set (see alpacaProvider.fetch).
 */
export const symbolNewsProviders: readonly SymbolNewsProvider[] = [finnhubProvider, alpacaProvider];

export async function fetchSymbolNews(
  symbol: string,
  log: SymbolNewsLog,
  signal?: AbortSignal,
): Promise<NormalizedArticle[]> {
  for (const provider of symbolNewsProviders) {
    try {
      const articles = await provider.fetch(symbol, log, signal);
      if (articles.length > 0) return articles;
    } catch (err) {
      log.warn({ err, provider: provider.id, symbol }, "Symbol news provider failed");
    }
  }
  return [];
}
