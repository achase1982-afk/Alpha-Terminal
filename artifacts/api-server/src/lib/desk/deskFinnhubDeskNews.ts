import { deskEnv } from "./deskEnv.js";
import { logger } from "../logger.js";
import {
  deskMarkFeedAuthError,
  deskMarkFeedError,
  deskMarkFeedRateLimited,
} from "./deskFeedFreshness.js";

const log = {
  warn: (o: unknown, m?: string) => logger.warn(o, m),
  info: (o: unknown, m?: string) => logger.info(o, m),
};

export type DeskFinnhubFetchResult = {
  ok: boolean;
  status: number;
  articles: unknown[];
};

export function getFinnhubDeskApiKey(): string {
  return deskEnv("FINNHUB_API_KEY");
}

export async function fetchFinnhubMarketGeneralNews(apiKey: string): Promise<DeskFinnhubFetchResult> {
  const url = `https://finnhub.io/api/v1/news?category=general&token=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) {
      log.warn({ status: res.status }, "Finnhub general news HTTP failed");
      return { ok: false, status: res.status, articles: [] };
    }
    const raw = await res.json();
    return { ok: true, status: res.status, articles: Array.isArray(raw) ? raw : [] };
  } catch (err) {
    log.warn({ err }, "Finnhub general news fetch failed");
    return { ok: false, status: 0, articles: [] };
  }
}

export async function deskFetchFinnhubCompanyNews(
  symbol: string,
  apiKey: string,
): Promise<DeskFinnhubFetchResult> {
  const clean = symbol.trim().toUpperCase();
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const toDate = now.toISOString().slice(0, 10);
  const fromDate = oneWeekAgo.toISOString().slice(0, 10);
  const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(clean)}&from=${fromDate}&to=${toDate}&token=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) {
      log.warn({ status: res.status, symbol: clean }, "Finnhub company news HTTP failed");
      return { ok: false, status: res.status, articles: [] };
    }
    const raw = (await res.json()) as unknown;
    return { ok: true, status: res.status, articles: Array.isArray(raw) ? raw : [] };
  } catch (err) {
    log.warn({ err, symbol: clean }, "Finnhub company news fetch failed");
    return { ok: false, status: 0, articles: [] };
  }
}

export function deskApplyFinnhubHttpStatus(status: number): void {
  if (status === 401 || status === 403) {
    deskMarkFeedAuthError("news", `finnhub_http_${status}`, "finnhub");
    return;
  }
  if (status === 429) {
    deskMarkFeedRateLimited("news", `finnhub_http_${status}`, "finnhub");
    return;
  }
  if (status > 0) {
    deskMarkFeedError("news", `finnhub_http_${status}`, "finnhub");
  } else if (status === 0) {
    deskMarkFeedError("news", "finnhub_fetch_error", "finnhub");
  }
}

export async function deskLoadFinnhubDeskArticles(symbols: string[]): Promise<{
  articles: unknown[];
  hadHttp2xx: boolean;
  lastErrorStatus?: number;
}> {
  const key = getFinnhubDeskApiKey();
  if (!key) return { articles: [], hadHttp2xx: false };

  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const deskSyms = uniq.length ? uniq : ["SPY", "QQQ"];
  const all: unknown[] = [];
  let hadHttp2xx = false;
  let lastErrorStatus: number | undefined;

  const general = await fetchFinnhubMarketGeneralNews(key);
  if (general.ok) {
    hadHttp2xx = true;
    for (const a of general.articles) all.push(a);
  } else {
    lastErrorStatus = general.status;
    deskApplyFinnhubHttpStatus(general.status);
  }

  for (const sym of deskSyms) {
    const r = await deskFetchFinnhubCompanyNews(sym, key);
    if (r.ok) {
      hadHttp2xx = true;
      for (const a of r.articles) all.push(a);
    } else {
      lastErrorStatus = r.status;
      if (!hadHttp2xx) deskApplyFinnhubHttpStatus(r.status);
    }
  }

  return { articles: all, hadHttp2xx, lastErrorStatus };
}