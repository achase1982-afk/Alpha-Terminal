import { fetchAlpacaNews } from "../symbolNewsProvider.js";
import { getAlpacaKeys } from "./deskAlpaca.js";
import { getAlpacaPaperKeys } from "./deskAlpacaPaper.js";
import {
  deskMarkFeedAuthError,
  deskMarkFeedError,
  deskMarkFeedNotConfigured,
  deskTouchFeed,
} from "./deskFeedFreshness.js";
import { logger } from "../logger.js";

const ALPACA_NEWS_URL = "https://data.alpaca.markets/v1beta1/news";
const ALPACA_SOURCE = "alpaca_news";

function alpacaNewsCredentials(): { keyId: string; secret: string } {
  const live = getAlpacaKeys();
  if (live.keyId && live.secret) {
    return { keyId: live.keyId.trim(), secret: live.secret.trim() };
  }
  const paper = getAlpacaPaperKeys();
  return { keyId: paper.keyId.trim(), secret: paper.secret.trim() };
}

function parseAlpacaNewsPayload(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    const o = json as { news?: unknown[]; articles?: unknown[] };
    if (Array.isArray(o.news)) return o.news;
    if (Array.isArray(o.articles)) return o.articles;
  }
  return [];
}

function newsUrl(sym: string, limit: number): string {
  const start = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const params = new URLSearchParams({
    symbols: sym,
    limit: String(limit),
    sort: "desc",
    start,
  });
  return `${ALPACA_NEWS_URL}?${params.toString()}`;
}

export async function deskFetchAlpacaNews(
  symbols: string[],
): Promise<{ ok: boolean; articles: unknown[]; asOfMs: number; status?: number; error?: string }> {
  const { keyId, secret } = alpacaNewsCredentials();
  if (!keyId || !secret) {
    deskMarkFeedNotConfigured("alpaca", ALPACA_SOURCE);
    return { ok: false, articles: [], asOfMs: Date.now(), status: 503, error: "not_configured" };
  }

  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const syms = uniq.length ? uniq : ["SPY"];
  const all: unknown[] = [];
  let asOfMs = Date.now();

  for (const sym of syms) {
    const res = await fetch(newsUrl(sym, 50), {
      headers: {
        "APCA-API-KEY-ID": keyId,
        "APCA-API-SECRET-KEY": secret,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status === 401 || res.status === 403) {
      const err = `alpaca_news_http_${res.status}`;
      deskMarkFeedAuthError("alpaca", err, ALPACA_SOURCE);
      logger.warn({ status: res.status, symbol: sym }, "Desk Alpaca news auth failed");
      return { ok: false, articles: [], asOfMs: Date.now(), status: res.status, error: err };
    }
    if (!res.ok) {
      const err = `alpaca_news_http_${res.status}`;
      deskMarkFeedError("alpaca", err, ALPACA_SOURCE);
      logger.warn({ status: res.status, symbol: sym }, "Desk Alpaca news HTTP failed");
      return { ok: false, articles: [], asOfMs: Date.now(), status: res.status, error: err };
    }
    const json = await res.json();
    const rows = parseAlpacaNewsPayload(json);
    if (rows.length) {
      for (const a of rows) all.push(a);
    } else {
      const normalized = await fetchAlpacaNews(sym, keyId, secret, logger);
      for (const a of normalized) {
        all.push(a);
        if (a.datetime) asOfMs = Math.max(asOfMs, a.datetime * 1000);
      }
    }
  }

  const pollMs = Date.now();
  let contentLatest = pollMs;
  for (const a of all) {
    const row = a as { created_at?: string; updated_at?: string };
    const ts =
      row.updated_at != null
        ? Date.parse(row.updated_at)
        : row.created_at != null
          ? Date.parse(row.created_at)
          : NaN;
    if (Number.isFinite(ts)) contentLatest = Math.max(contentLatest, ts);
  }
  const touchMs = Math.max(contentLatest, pollMs - 30_000);
  deskTouchFeed("alpaca", touchMs, ALPACA_SOURCE);
  return { ok: true, articles: all, asOfMs: touchMs, status: 200 };
}

export async function deskProbeAlpacaNews(): Promise<void> {
  const { keyId, secret } = alpacaNewsCredentials();
  if (!keyId || !secret) return;
  try {
    const res = await fetch(newsUrl("SPY", 1), {
      headers: {
        "APCA-API-KEY-ID": keyId,
        "APCA-API-SECRET-KEY": secret,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status === 401 || res.status === 403) {
      deskMarkFeedAuthError("alpaca", `alpaca_news_http_${res.status}`, ALPACA_SOURCE);
      return;
    }
    if (!res.ok) {
      deskMarkFeedError("alpaca", `alpaca_news_http_${res.status}`, ALPACA_SOURCE);
      return;
    }
    await res.json();
    deskTouchFeed("alpaca", Date.now(), ALPACA_SOURCE);
  } catch (err) {
    deskMarkFeedError("alpaca", "alpaca_news_fetch_error", ALPACA_SOURCE);
    logger.warn({ err }, "Desk Alpaca news probe failed");
  }
}