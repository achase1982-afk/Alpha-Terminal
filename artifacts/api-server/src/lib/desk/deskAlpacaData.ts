import { resolveDeskAlpacaMarketKeys } from "./deskAlpacaResolve.js";
import { logUpstreamFailure } from "../upstreamTelemetry.js";
import {
  deskMarkFeedAuthError,
  deskMarkFeedError,
  deskMarkFeedNotConfigured,
  deskTouchFeed,
} from "./deskFeedFreshness.js";

const ALPACA_DATA = "https://data.alpaca.markets";

function headers(keyId: string, secret: string): Record<string, string> {
  return {
    "APCA-API-KEY-ID": keyId,
    "APCA-API-SECRET-KEY": secret,
    Accept: "application/json",
  };
}

export async function deskAlpacaMarketQuotes(
  symbols: string[],
): Promise<{ ok: boolean; quotes: Record<string, unknown>[]; asOfMs: number; status?: number; error?: string; source: string }> {
  const { keyId, secret, feedId, source } = resolveDeskAlpacaMarketKeys();
  if (!keyId || !secret) {
    deskMarkFeedNotConfigured("alpaca_paper", "alpaca");
    deskMarkFeedNotConfigured("alpaca", "alpaca_news");
    return { ok: false, quotes: [], asOfMs: Date.now(), status: 503, error: "not_configured", source: "alpaca" };
  }

  const out: Record<string, unknown>[] = [];
  let latest = Date.now();

  for (const raw of symbols) {
    const sym = raw.trim().toUpperCase();
    if (!sym) continue;
    const url = `${ALPACA_DATA}/v2/stocks/${encodeURIComponent(sym)}/quotes/latest`;
    const res = await fetch(url, {
      headers: headers(keyId, secret),
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status === 401 || res.status === 403) {
      const err = `alpaca_http_${res.status}`;
      deskMarkFeedAuthError(feedId, err, source);
      logUpstreamFailure("ALPACA", `/v2/stocks/${sym}/quotes/latest`, res.status);
      return { ok: false, quotes: [], asOfMs: Date.now(), status: res.status, error: err, source };
    }
    if (!res.ok) {
      deskMarkFeedError(feedId, `alpaca_http_${res.status}`, source);
      logUpstreamFailure("ALPACA", `/v2/stocks/${sym}/quotes/latest`, res.status);
      continue;
    }
    const json = (await res.json()) as { quote?: Record<string, unknown> };
    if (json.quote) {
      out.push({ symbol: sym, ...json.quote });
      const t = json.quote["t"] as string | undefined;
      if (t) latest = Math.max(latest, Date.parse(t));
    }
  }

  if (out.length) {
    deskTouchFeed(feedId, latest, source);
    return { ok: true, quotes: out, asOfMs: latest, source };
  }
  return { ok: false, quotes: [], asOfMs: Date.now(), status: 502, error: "alpaca_quotes_empty", source };
}

export async function deskAlpacaMarketBars(
  symbol: string,
  timeframe: string,
  limit: number,
): Promise<{ ok: boolean; bars: unknown[]; asOfMs: number; status?: number; error?: string; source: string }> {
  const { keyId, secret, feedId, source } = resolveDeskAlpacaMarketKeys();
  if (!keyId || !secret) {
    deskMarkFeedNotConfigured("alpaca_paper", "alpaca");
    return { ok: false, bars: [], asOfMs: Date.now(), status: 503, error: "not_configured", source: "alpaca" };
  }

  const sym = symbol.trim().toUpperCase();
  const tf = timeframe === "1d" || timeframe === "daily" ? "1Day" : "1Min";
  const start = new Date(Date.now() - limit * 86_400_000).toISOString();
  const url = `${ALPACA_DATA}/v2/stocks/${encodeURIComponent(sym)}/bars?timeframe=${tf}&start=${encodeURIComponent(start)}&limit=${limit}&adjustment=raw&feed=iex`;
  const res = await fetch(url, {
    headers: headers(keyId, secret),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) {
    const err = `alpaca_http_${res.status}`;
    deskMarkFeedAuthError(feedId, err, source);
    logUpstreamFailure("ALPACA", `/v2/stocks/${sym}/bars`, res.status);
    return { ok: false, bars: [], asOfMs: Date.now(), status: res.status, error: err, source };
  }
  if (!res.ok) {
    deskMarkFeedError(feedId, `alpaca_http_${res.status}`, source);
    logUpstreamFailure("ALPACA", `/v2/stocks/${sym}/bars`, res.status);
    return { ok: false, bars: [], asOfMs: Date.now(), status: res.status, error: `alpaca_http_${res.status}`, source };
  }
  const json = (await res.json()) as { bars?: unknown[] };
  const bars = json.bars ?? [];
  const touch = Date.now();
  deskTouchFeed(feedId, touch, source);
  return { ok: true, bars, asOfMs: touch, source };
}