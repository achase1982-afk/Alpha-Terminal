import pLimit from "p-limit";
import { deskEnv } from "./deskEnv.js";
import { DESK_DEFAULT_NEWS_SYMBOLS } from "./deskDefaultNewsSymbols.js";
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

export const FINNHUB_DESK_CALL_TIMEOUT_MS = 5_000;
export const FINNHUB_DESK_COMPANY_CONCURRENCY = 4;
const FINNHUB_DESK_MAX_PER_MINUTE = 60;
const FINNHUB_RATE_WINDOW_MS = 60_000;

const recentFinnhubCallTimes: number[] = [];
const companyFetchLimit = pLimit(FINNHUB_DESK_COMPANY_CONCURRENCY);

function pruneFinnhubRateWindow(now: number): void {
  while (recentFinnhubCallTimes.length > 0 && now - recentFinnhubCallTimes[0]! >= FINNHUB_RATE_WINDOW_MS) {
    recentFinnhubCallTimes.shift();
  }
}

async function waitForFinnhubRateSlot(): Promise<void> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const now = Date.now();
    pruneFinnhubRateWindow(now);
    if (recentFinnhubCallTimes.length < FINNHUB_DESK_MAX_PER_MINUTE) {
      recentFinnhubCallTimes.push(now);
      return;
    }
    const oldest = recentFinnhubCallTimes[0]!;
    const waitMs = Math.max(FINNHUB_RATE_WINDOW_MS - (now - oldest) + 25, 50);
    await new Promise((r) => setTimeout(r, Math.min(waitMs, 5_000)));
  }
}

async function finnhubDeskHttpGet(url: string): Promise<Response> {
  await waitForFinnhubRateSlot();
  return fetch(url, { signal: AbortSignal.timeout(FINNHUB_DESK_CALL_TIMEOUT_MS) });
}

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
    const res = await finnhubDeskHttpGet(url);
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
    const res = await finnhubDeskHttpGet(url);
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
  const deskSyms = uniq.length ? uniq : [...DESK_DEFAULT_NEWS_SYMBOLS];
  const all: unknown[] = [];
  let hadHttp2xx = false;
  let lastErrorStatus: number | undefined;

  const general = await fetchFinnhubMarketGeneralNews(key);
  if (general.ok) {
    hadHttp2xx = true;
    for (const a of general.articles) all.push(a);
  } else {
    lastErrorStatus = general.status;
  }

  const companyResults = await Promise.all(
    deskSyms.map((sym) =>
      companyFetchLimit(() => deskFetchFinnhubCompanyNews(sym, key)),
    ),
  );
  for (const r of companyResults) {
    if (r.ok) {
      hadHttp2xx = true;
      for (const a of r.articles) all.push(a);
    } else {
      lastErrorStatus = r.status;
    }
  }

  return { articles: all, hadHttp2xx, lastErrorStatus };
}

export function deskResetFinnhubRateLimitForTests(): void {
  recentFinnhubCallTimes.length = 0;
}