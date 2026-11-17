import { deskEnv } from "./deskEnv.js";
import { deskSessionDateEt } from "./deskEt.js";
import {
  deskMarkFeedAuthError,
  deskMarkFeedError,
  deskMarkFeedNotConfigured,
  deskTouchFeed,
} from "./deskFeedFreshness.js";
import { logger } from "../logger.js";

const SOURCE = "alphavantage";
const DAILY_CAP = 25;

let callsOnSessionDay = 0;
let callsSessionDay = "";

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

export async function deskProbeAlphaVantage(): Promise<void> {
  const key = getAlphaVantageKey();
  if (!key) {
    deskMarkFeedNotConfigured("alphavantage", SOURCE);
    return;
  }
  if (!canCallAlphaVantage()) {
    logger.info("Desk AlphaVantage boot probe skipped (daily cap)");
    return;
  }
  try {
    const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=SPY&limit=1&apikey=${encodeURIComponent(key)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    recordAlphaVantageCall();
    if (res.status === 401 || res.status === 403) {
      deskMarkFeedAuthError("alphavantage", `alphavantage_http_${res.status}`, SOURCE);
      return;
    }
    const json = (await res.json()) as { Information?: string; Note?: string };
    if (json.Information || json.Note) {
      deskMarkFeedError("alphavantage", "alphavantage_rate_or_info", SOURCE);
      return;
    }
    if (!res.ok) {
      deskMarkFeedError("alphavantage", `alphavantage_http_${res.status}`, SOURCE);
      return;
    }
    deskTouchFeed("alphavantage", Date.now(), SOURCE);
  } catch (err) {
    deskMarkFeedError("alphavantage", "alphavantage_probe_error", SOURCE);
    logger.warn({ err }, "Desk AlphaVantage probe failed");
  }
}

export async function deskFetchAlphaVantageNews(
  symbols: string[],
): Promise<{ ok: boolean; articles: unknown[]; asOfMs: number; status?: number; error?: string }> {
  const key = getAlphaVantageKey();
  if (!key) {
    deskMarkFeedNotConfigured("alphavantage", SOURCE);
    return { ok: false, articles: [], asOfMs: Date.now(), status: 503, error: "not_configured" };
  }
  if (!canCallAlphaVantage()) {
    return { ok: false, articles: [], asOfMs: Date.now(), status: 429, error: "alphavantage_daily_cap" };
  }
  const tickers = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean).join(",") || "SPY";
  const url = `https://www.alphavantage.co/query?function=NEWS_SENTIMENT&tickers=${encodeURIComponent(tickers)}&limit=50&apikey=${encodeURIComponent(key)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  recordAlphaVantageCall();
  if (res.status === 401 || res.status === 403) {
    const err = `alphavantage_http_${res.status}`;
    deskMarkFeedAuthError("alphavantage", err, SOURCE);
    return { ok: false, articles: [], asOfMs: Date.now(), status: res.status, error: err };
  }
  const json = (await res.json()) as { feed?: unknown[]; Information?: string; Note?: string };
  if (json.Information || json.Note) {
    deskMarkFeedError("alphavantage", "alphavantage_rate_or_info", SOURCE);
    return { ok: false, articles: [], asOfMs: Date.now(), status: 429, error: "alphavantage_rate_or_info" };
  }
  if (!res.ok) {
    deskMarkFeedError("alphavantage", `alphavantage_http_${res.status}`, SOURCE);
    return { ok: false, articles: [], asOfMs: Date.now(), status: res.status, error: `alphavantage_http_${res.status}` };
  }
  const articles = json.feed ?? [];
  const touch = Date.now();
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
  if (!canCallAlphaVantage()) {
    return { ok: false, data: null, asOfMs: Date.now(), status: 429, error: "alphavantage_daily_cap" };
  }
  const sym = symbol.trim().toUpperCase() || "SPY";
  const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(key)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  recordAlphaVantageCall();
  if (res.status === 401 || res.status === 403) {
    const err = `alphavantage_http_${res.status}`;
    deskMarkFeedAuthError("alphavantage", err, SOURCE);
    return { ok: false, data: null, asOfMs: Date.now(), status: res.status, error: err };
  }
  const json = await res.json();
  const touch = Date.now();
  deskTouchFeed("alphavantage", touch, SOURCE);
  return { ok: true, data: json, asOfMs: touch };
}