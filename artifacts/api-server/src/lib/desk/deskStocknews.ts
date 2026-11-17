import { deskEnv } from "./deskEnv.js";
import {
  deskMarkFeedAuthError,
  deskMarkFeedError,
  deskMarkFeedNotConfigured,
  deskTouchFeed,
} from "./deskFeedFreshness.js";
import { logger } from "../logger.js";

const SOURCE = "stocknews";

export function getStocknewsKey(): string {
  return deskEnv("STOCKNEWS_API_KEY");
}

export async function deskProbeStocknews(): Promise<void> {
  const key = getStocknewsKey();
  if (!key) {
    deskMarkFeedNotConfigured("stocknews", SOURCE);
    return;
  }
  try {
    const url = `https://stocknewsapi.com/api/v1?tickers=SPY&items=1&token=${encodeURIComponent(key)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (res.status === 401 || res.status === 403) {
      deskMarkFeedAuthError("stocknews", `stocknews_http_${res.status}`, SOURCE);
      return;
    }
    if (!res.ok) {
      deskMarkFeedError("stocknews", `stocknews_http_${res.status}`, SOURCE);
      return;
    }
    deskTouchFeed("stocknews", Date.now(), SOURCE);
  } catch (err) {
    deskMarkFeedError("stocknews", "stocknews_probe_error", SOURCE);
    logger.warn({ err }, "Desk StockNews probe failed");
  }
}

export async function deskFetchStocknews(
  symbols: string[],
): Promise<{ ok: boolean; articles: unknown[]; asOfMs: number; status?: number; error?: string }> {
  const key = getStocknewsKey();
  if (!key) {
    deskMarkFeedNotConfigured("stocknews", SOURCE);
    return { ok: false, articles: [], asOfMs: Date.now(), status: 503, error: "not_configured" };
  }
  const sym = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean).join(",") || "SPY";
  const url = `https://stocknewsapi.com/api/v1?tickers=${encodeURIComponent(sym)}&items=50&token=${encodeURIComponent(key)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (res.status === 401 || res.status === 403) {
    const err = `stocknews_http_${res.status}`;
    deskMarkFeedAuthError("stocknews", err, SOURCE);
    return { ok: false, articles: [], asOfMs: Date.now(), status: res.status, error: err };
  }
  if (!res.ok) {
    deskMarkFeedError("stocknews", `stocknews_http_${res.status}`, SOURCE);
    return { ok: false, articles: [], asOfMs: Date.now(), status: res.status, error: `stocknews_http_${res.status}` };
  }
  const json = (await res.json()) as unknown;
  const articles = Array.isArray(json) ? json : (json as { data?: unknown[] }).data ?? [];
  const touch = Date.now();
  deskTouchFeed("stocknews", touch, SOURCE);
  return { ok: true, articles, asOfMs: touch };
}