import { getAlpacaKeys } from "./deskAlpaca.js";
import { getAlpacaPaperKeys } from "./deskAlpacaPaper.js";
import {
  deskMarkFeedAuthError,
  deskMarkFeedError,
  deskMarkFeedNotConfigured,
  deskTouchFeedArticleAge,
  deskTouchFeedPollOk,
} from "./deskFeedFreshness.js";
import { deskMaxArticlePublishedMs } from "./deskNewsArticleAge.js";
import { DESK_DEFAULT_NEWS_SYMBOLS } from "./deskDefaultNewsSymbols.js";
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

export function parseAlpacaNewsPayload(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    const o = json as { news?: unknown[]; articles?: unknown[] };
    if (Array.isArray(o.news)) return o.news;
    if (Array.isArray(o.articles)) return o.articles;
  }
  return [];
}

export function newsUrl(symbols: string[] | null, limit: number, windowMs: number): string {
  const start = new Date(Date.now() - windowMs).toISOString();
  const params = new URLSearchParams({
    limit: String(limit),
    sort: "desc",
    start,
  });
  if (symbols?.length) params.set("symbols", symbols.join(","));
  return `${ALPACA_NEWS_URL}?${params.toString()}`;
}

const MS_24H = 24 * 60 * 60 * 1000;
const MS_7D = 7 * MS_24H;

async function fetchAlpacaNewsWindow(
  keyId: string,
  secret: string,
  syms: string[] | null,
  limit: number,
  windowMs: number,
): Promise<{ ok: boolean; articles: unknown[]; status: number }> {
  const res = await fetch(newsUrl(syms, limit, windowMs), {
    headers: {
      "APCA-API-KEY-ID": keyId,
      "APCA-API-SECRET-KEY": secret,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) {
    return { ok: false, articles: [], status: res.status };
  }
  const json = await res.json();
  return { ok: true, articles: parseAlpacaNewsPayload(json), status: res.status };
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
  const syms = uniq.length ? uniq : [...DESK_DEFAULT_NEWS_SYMBOLS];

  let r: { ok: boolean; articles: unknown[]; status: number };
  try {
    r = await fetchAlpacaNewsWindow(keyId, secret, syms, 50, MS_24H);
    if (r.ok && r.articles.length === 0) {
      r = await fetchAlpacaNewsWindow(keyId, secret, syms, 50, MS_7D);
    }
  } catch (err) {
    logger.warn({ err }, "Desk Alpaca news fetch error");
    deskMarkFeedError("alpaca", "alpaca_news_fetch_error", ALPACA_SOURCE);
    return { ok: false, articles: [], asOfMs: Date.now(), status: 503, error: "alpaca_news_fetch_error" };
  }

  if (r.status === 401 || r.status === 403) {
    const err = `alpaca_news_http_${r.status}`;
    deskMarkFeedAuthError("alpaca", err, ALPACA_SOURCE);
    logger.warn({ status: r.status }, "Desk Alpaca news auth failed");
    return { ok: false, articles: [], asOfMs: Date.now(), status: r.status, error: err };
  }
  if (!r.ok) {
    const err = `alpaca_news_http_${r.status}`;
    deskMarkFeedError("alpaca", err, ALPACA_SOURCE);
    logger.warn({ status: r.status }, "Desk Alpaca news HTTP failed");
    return { ok: false, articles: [], asOfMs: Date.now(), status: r.status, error: err };
  }

  const pollMs = Date.now();
  const articleMs = deskMaxArticlePublishedMs(r.articles);
  deskTouchFeedPollOk("alpaca", pollMs, ALPACA_SOURCE);
  deskTouchFeedArticleAge("alpaca", articleMs, ALPACA_SOURCE);
  return { ok: true, articles: r.articles, asOfMs: articleMs ?? pollMs, status: 200 };
}

export async function deskProbeAlpacaNews(): Promise<void> {
  const { keyId, secret } = alpacaNewsCredentials();
  if (!keyId || !secret) return;
  try {
    const probeSyms = [...DESK_DEFAULT_NEWS_SYMBOLS];
    let r = await fetchAlpacaNewsWindow(keyId, secret, probeSyms, 5, MS_24H);
    if (r.ok && r.articles.length === 0) {
      r = await fetchAlpacaNewsWindow(keyId, secret, null, 5, MS_7D);
    }
    if (r.status === 401 || r.status === 403) {
      deskMarkFeedAuthError("alpaca", `alpaca_news_http_${r.status}`, ALPACA_SOURCE);
      return;
    }
    if (!r.ok) {
      deskMarkFeedError("alpaca", `alpaca_news_http_${r.status}`, ALPACA_SOURCE);
      return;
    }
    const pollMs = Date.now();
    const articleMs = deskMaxArticlePublishedMs(r.articles);
    deskTouchFeedPollOk("alpaca", pollMs, ALPACA_SOURCE);
    deskTouchFeedArticleAge("alpaca", articleMs, ALPACA_SOURCE);
  } catch (err) {
    deskMarkFeedError("alpaca", "alpaca_news_fetch_error", ALPACA_SOURCE);
    logger.warn({ err }, "Desk Alpaca news probe failed");
  }
}
