import { fetchAlpacaNews } from "../symbolNewsProvider.js";
import { getAlpacaKeys } from "./deskAlpaca.js";
import {
  deskMarkFeedAuthError,
  deskMarkFeedError,
  deskMarkFeedNotConfigured,
  deskTouchFeed,
} from "./deskFeedFreshness.js";
import { logger } from "../logger.js";

const ALPACA_NEWS_URL = "https://data.alpaca.markets/v1beta1/news";
const ALPACA_SOURCE = "alpaca_news";

export async function deskFetchAlpacaNews(
  symbols: string[],
): Promise<{ ok: boolean; articles: unknown[]; asOfMs: number; status?: number; error?: string }> {
  const { keyId, secret } = getAlpacaKeys();
  if (!keyId || !secret) {
    deskMarkFeedNotConfigured("alpaca", ALPACA_SOURCE);
    return { ok: false, articles: [], asOfMs: Date.now(), status: 503, error: "not_configured" };
  }

  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const syms = uniq.length ? uniq : ["SPY"];
  const all: unknown[] = [];
  let asOfMs = Date.now();

  for (const sym of syms) {
    const probe = await fetch(`${ALPACA_NEWS_URL}?symbols=${encodeURIComponent(sym)}&limit=50&sort=desc`, {
      headers: {
        "APCA-API-KEY-ID": keyId,
        "APCA-API-SECRET-KEY": secret,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (probe.status === 401 || probe.status === 403) {
      const err = `alpaca_news_http_${probe.status}`;
      deskMarkFeedAuthError("alpaca", err, ALPACA_SOURCE);
      logger.warn({ status: probe.status, symbol: sym }, "Desk Alpaca news auth failed");
      return { ok: false, articles: [], asOfMs: Date.now(), status: probe.status, error: err };
    }
    if (!probe.ok) {
      const err = `alpaca_news_http_${probe.status}`;
      deskMarkFeedError("alpaca", err, ALPACA_SOURCE);
      logger.warn({ status: probe.status, symbol: sym }, "Desk Alpaca news HTTP failed");
      return { ok: false, articles: [], asOfMs: Date.now(), status: probe.status, error: err };
    }
    const rows = await fetchAlpacaNews(sym, keyId, secret, logger);
    for (const a of rows) {
      all.push(a);
      if (a.datetime) asOfMs = Math.max(asOfMs, a.datetime * 1000);
    }
  }

  if (!all.length) {
    deskMarkFeedError("alpaca", "alpaca_news_empty", ALPACA_SOURCE);
    return { ok: false, articles: [], asOfMs: Date.now(), status: 502, error: "alpaca_news_empty" };
  }

  const touchMs = Date.now();
  deskTouchFeed("alpaca", touchMs, ALPACA_SOURCE);
  return { ok: true, articles: all, asOfMs: touchMs, status: 200 };
}

export async function deskProbeAlpacaNews(): Promise<void> {
  const { keyId, secret } = getAlpacaKeys();
  if (!keyId || !secret) return;
  const url = `${ALPACA_NEWS_URL}?symbols=SPY&limit=1&sort=desc`;
  try {
    const res = await fetch(url, {
      headers: {
        "APCA-API-KEY-ID": keyId,
        "APCA-API-SECRET-KEY": secret,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status === 401 || res.status === 403) {
      deskMarkFeedAuthError("alpaca", `alpaca_news_http_${res.status}`, ALPACA_SOURCE);
      logger.warn({ status: res.status }, "Desk Alpaca news auth failed");
      return;
    }
    if (!res.ok) {
      deskMarkFeedError("alpaca", `alpaca_news_http_${res.status}`, ALPACA_SOURCE);
      logger.warn({ status: res.status }, "Desk Alpaca news HTTP failed");
      return;
    }
    deskTouchFeed("alpaca", Date.now(), ALPACA_SOURCE);
  } catch (err) {
    deskMarkFeedError("alpaca", "alpaca_news_fetch_error", ALPACA_SOURCE);
    logger.warn({ err }, "Desk Alpaca news probe failed");
  }
}