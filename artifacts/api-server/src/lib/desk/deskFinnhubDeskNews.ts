import { deskEnv } from "./deskEnv.js";
import { logger } from "../logger.js";
import { fetchFinnhubNews } from "../tickerNewsAggregated.js";

const log = {
  warn: (o: unknown, m?: string) => logger.warn(o, m),
  info: (o: unknown, m?: string) => logger.info(o, m),
};

export async function fetchFinnhubMarketGeneralNews(apiKey: string): Promise<unknown[]> {
  const url = `https://finnhub.io/api/v1/news?category=general&token=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) {
    log.warn({ status: res.status }, "Finnhub general news HTTP failed");
    return [];
  }
  const raw = await res.json();
  return Array.isArray(raw) ? raw : [];
}

export function getFinnhubDeskApiKey(): string {
  return deskEnv("FINNHUB_API_KEY");
}

export async function deskLoadFinnhubDeskArticles(symbols: string[]): Promise<{
  articles: unknown[];
  hadSuccess: boolean;
}> {
  const key = getFinnhubDeskApiKey();
  if (!key) return { articles: [], hadSuccess: false };

  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const deskSyms = uniq.length ? uniq : ["SPY", "QQQ"];
  const all: unknown[] = [];
  let hadSuccess = false;

  try {
    const general = await fetchFinnhubMarketGeneralNews(key);
    if (general.length) {
      hadSuccess = true;
      for (const a of general) all.push(a);
    }
  } catch (err) {
    logger.warn({ err }, "Finnhub general news fetch failed");
  }

  for (const sym of deskSyms) {
    try {
      const rows = await fetchFinnhubNews(sym, key, log);
      hadSuccess = true;
      for (const a of rows) all.push(a);
    } catch (err) {
      logger.warn({ err, sym }, "Finnhub symbol news fetch failed");
    }
  }

  return { articles: all, hadSuccess };
}