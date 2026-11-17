import { deskEnv } from "./deskEnv.js";
import { deskSessionDateEt } from "./deskEt.js";
import {
  deskMarkFeedAuthError,
  deskMarkFeedNotConfigured,
  deskMarkFeedRateLimited,
  deskTouchFeed,
} from "./deskFeedFreshness.js";

const SOURCE = "alphavantage";
const DAILY_CAP = 25;

let callsOnSessionDay = 0;
let callsSessionDay = "";

type CacheEntry<T> = { data: T; asOfMs: number; sessionDay: string };
const newsCache = new Map<string, CacheEntry<unknown[]>>();
const overviewCache = new Map<string, CacheEntry<unknown>>();

function canCallAlphaVantage(): boolean {
  const d = deskSessionDateEt();
  if (d !== callsSessionDay) {
    callsSessionDay = d;
    callsOnSessionDay = 0;
  }
  return callsOnSessionDay < DAILY_CAP;
}

function recordAlphaVantageCall(): void {
  const d = deskSessionDateEt();
  if (d !== callsSessionDay) {
    callsSessionDay = d;
    callsOnSessionDay = 0;
  }
  callsOnSessionDay += 1;
}

export function getAlphaVantageKey(): string {
  return deskEnv("ALPHAVANTAGE_API_KEY");
}

function isRateLimitPayload(json: { Information?: string; Note?: string }): boolean {
  const msg = [json.Information, json.Note].filter(Boolean).join(" ");
  return /rate|limit|premium|call frequency|spreading/i.test(msg);
}

/** Boot /health must not burn API calls — probes are on-demand only via /news or /fundamentals. */
export async function deskProbeAlphaVantage(): Promise<void> {
  const key = getAlphaVantageKey();
  if (!key) deskMarkFeedNotConfigured("alphavantage", SOURCE);
}

export async function deskFetchAlphaVantageNews(
  symbols: string[],
): Promise<{ ok: boolean; articles: unknown[]; asOfMs: number; status?: number; error?: string }> {
  const key = getAlphaVantageKey();
  if (!key) {
    deskMarkFeedNotConfigured("alphavantage", SOURCE);
    return { ok: false, articles: [], asOfMs: Date.now(), status: 503, error: "not_configured" };
  }
  const tickers = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean).join(",") || "SPY";
  const sessionDay = deskSessionDateEt();
  const hit = newsCache.get(tickers);
  if (hit && hit.sessionDay === sessionDay) {
    return { ok: true, articles: hit.data, asOfMs: hit.asOfMs };
  }
  if (!canCallAlphaVantage()) {
    if (hit) return { ok: true, articles: hit.data, asOfMs: hit.asOfMs };
    deskMarkFeedRateLimited("alphavantage", "alphavantage_daily_cap", SOURCE);
    return { ok: false, articles: [], asOfMs: Date.now(), status: 429, error: "alphavantage_daily_cap" };
  }
  const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${encodeURIComponent(tickers)}&limit=50&apikey=${encodeURIComponent(key)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  recordAlphaVantageCall();
  if (res.status === 401 || res.status === 403) {
    const err = `alphavantage_http_${res.status}`;
    deskMarkFeedAuthError("alphavantage", err, SOURCE);
    return { ok: false, articles: [], asOfMs: Date.now(), status: res.status, error: err };
  }
  const json = (await res.json()) as { feed?: unknown[]; Information?: string; Note?: string };
  if (isRateLimitPayload(json)) {
    deskMarkFeedRateLimited("alphavantage", "alphavantage_rate_or_info", SOURCE);
    if (hit) return { ok: true, articles: hit.data, asOfMs: hit.asOfMs };
    return { ok: false, articles: [], asOfMs: Date.now(), status: 429, error: "alphavantage_rate_or_info" };
  }
  if (!res.ok) {
    return { ok: false, articles: [], asOfMs: Date.now(), status: res.status, error: `alphavantage_http_${res.status}` };
  }
  const articles = json.feed ?? [];
  const touch = Date.now();
  newsCache.set(tickers, { data: articles, asOfMs: touch, sessionDay });
  deskTouchFeed("alphavantage", touch, SOURCE);
  return { ok: true, articles, asOfMs: touch };
}

export async function deskFetchAlphaVantageOverview(
  symbol: string,
): Promise<{ ok: boolean; data: unknown; asOfMs: number; status?: number; error?: string }> {
  const key = getAlphaVantageKey();
  if (!key) {
    deskMarkFeedNotConfigured("alphavantage", SOURCE);
    return { ok: false, data: null, asOfMs: Date.now(), status: 503, error: "not_configured" };
  }
  const sym = symbol.trim().toUpperCase() || "SPY";
  const sessionDay = deskSessionDateEt();
  const hit = overviewCache.get(sym);
  if (hit && hit.sessionDay === sessionDay) {
    return { ok: true, data: hit.data, asOfMs: hit.asOfMs };
  }
  if (!canCallAlphaVantage()) {
    if (hit) return { ok: true, data: hit.data, asOfMs: hit.asOfMs };
    deskMarkFeedRateLimited("alphavantage", "alphavantage_daily_cap", SOURCE);
    return { ok: false, data: null, asOfMs: Date.now(), status: 429, error: "alphavantage_daily_cap" };
  }
  const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(key)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  recordAlphaVantageCall();
  const json = (await res.json()) as { Information?: string; Note?: string };
  if (isRateLimitPayload(json)) {
    deskMarkFeedRateLimited("alphavantage", "alphavantage_rate_or_info", SOURCE);
    if (hit) return { ok: true, data: hit.data, asOfMs: hit.asOfMs };
    return { ok: false, data: null, asOfMs: Date.now(), status: 429, error: "alphavantage_rate_or_info" };
  }
  if (!res.ok) {
    return { ok: false, data: null, asOfMs: Date.now(), status: res.status, error: `alphavantage_http_${res.status}` };
  }
  const touch = Date.now();
  overviewCache.set(sym, { data: json, asOfMs: touch, sessionDay });
  deskTouchFeed("alphavantage", touch, SOURCE);
  return { ok: true, data: json, asOfMs: touch };
}
