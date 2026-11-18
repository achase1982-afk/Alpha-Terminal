import { deskEnv } from "./deskEnv.js";
import {
  deskMarkFeedAuthError,
  deskMarkFeedError,
  deskMarkFeedNotConfigured,
  deskTouchFeed,
} from "./deskFeedFreshness.js";
import { classShareForVendor } from "../classShareSymbology.js";
import { logger } from "../logger.js";

const ALPACA_DATA = "https://data.alpaca.markets";
const SOURCE = "alpaca_paper";

export function getAlpacaPaperKeys(): { keyId: string; secret: string } {
  const keyId = deskEnv("ALPACA_PAPER_API_KEY_ID");
  const secret = deskEnv("ALPACA_PAPER_API_SECRET_KEY");
  return { keyId, secret };
}

function paperHeaders(keyId: string, secret: string): Record<string, string> {
  return {
    "APCA-API-KEY-ID": keyId,
    "APCA-API-SECRET-KEY": secret,
    Accept: "application/json",
  };
}

export async function deskProbeAlpacaPaper(): Promise<void> {
  const { keyId, secret } = getAlpacaPaperKeys();
  if (!keyId || !secret) {
    deskMarkFeedNotConfigured("alpaca_paper", SOURCE);
    return;
  }
  try {
    const res = await fetch(`${ALPACA_DATA}/v2/stocks/SPY/quotes/latest`, {
      headers: paperHeaders(keyId, secret),
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status === 401 || res.status === 403) {
      deskMarkFeedAuthError("alpaca_paper", `alpaca_paper_http_${res.status}`, SOURCE);
      return;
    }
    if (!res.ok) {
      deskMarkFeedError("alpaca_paper", `alpaca_paper_http_${res.status}`, SOURCE);
      return;
    }
    deskTouchFeed("alpaca_paper", Date.now(), SOURCE);
  } catch (err) {
    deskMarkFeedError("alpaca_paper", "alpaca_paper_probe_error", SOURCE);
    logger.warn({ err }, "Desk Alpaca paper probe failed");
  }
}

export async function deskAlpacaPaperQuotes(
  symbols: string[],
): Promise<{ ok: boolean; quotes: Record<string, unknown>[]; asOfMs: number; status?: number; error?: string }> {
  const { keyId, secret } = getAlpacaPaperKeys();
  if (!keyId || !secret) {
    deskMarkFeedNotConfigured("alpaca_paper", SOURCE);
    return { ok: false, quotes: [], asOfMs: Date.now(), status: 503, error: "not_configured" };
  }

  const out: Record<string, unknown>[] = [];
  let latest = Date.now();

  for (const raw of symbols) {
    const display = raw.trim().toUpperCase();
    if (!display) continue;
    const apiSym = classShareForVendor(display, "alpaca_paper");
    const res = await fetch(`${ALPACA_DATA}/v2/stocks/${encodeURIComponent(apiSym)}/quotes/latest`, {
      headers: paperHeaders(keyId, secret),
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status === 401 || res.status === 403) {
      const err = `alpaca_paper_http_${res.status}`;
      deskMarkFeedAuthError("alpaca_paper", err, SOURCE);
      return { ok: false, quotes: [], asOfMs: Date.now(), status: res.status, error: err };
    }
    if (!res.ok) {
      deskMarkFeedError("alpaca_paper", `alpaca_paper_http_${res.status}`, SOURCE);
      continue;
    }
    const json = (await res.json()) as { quote?: Record<string, unknown> };
    if (json.quote) {
      out.push({ symbol: display, ...json.quote });
      const t = json.quote["t"] as string | undefined;
      if (t) latest = Math.max(latest, Date.parse(t));
    }
  }

  if (out.length) {
    deskTouchFeed("alpaca_paper", latest, SOURCE);
    return { ok: true, quotes: out, asOfMs: latest };
  }
  return { ok: false, quotes: [], asOfMs: Date.now(), status: 502, error: "alpaca_paper_empty" };
}

export async function deskAlpacaPaperBars(
  symbol: string,
  timeframe: string,
  limit: number,
): Promise<{ ok: boolean; bars: unknown[]; asOfMs: number; status?: number; error?: string }> {
  const { keyId, secret } = getAlpacaPaperKeys();
  if (!keyId || !secret) {
    deskMarkFeedNotConfigured("alpaca_paper", SOURCE);
    return { ok: false, bars: [], asOfMs: Date.now(), status: 503, error: "not_configured" };
  }

  const display = symbol.trim().toUpperCase();
  const apiSym = classShareForVendor(display, "alpaca_paper");
  const tf = timeframe === "1d" || timeframe === "daily" ? "1Day" : "1Min";
  const start = new Date(Date.now() - limit * 86_400_000).toISOString();
  const url = `${ALPACA_DATA}/v2/stocks/${encodeURIComponent(apiSym)}/bars?timeframe=${tf}&start=${encodeURIComponent(start)}&limit=${limit}&adjustment=raw&feed=iex`;
  const res = await fetch(url, {
    headers: paperHeaders(keyId, secret),
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 401 || res.status === 403) {
    const err = `alpaca_paper_http_${res.status}`;
    deskMarkFeedAuthError("alpaca_paper", err, SOURCE);
    return { ok: false, bars: [], asOfMs: Date.now(), status: res.status, error: err };
  }
  if (!res.ok) {
    deskMarkFeedError("alpaca_paper", `alpaca_paper_http_${res.status}`, SOURCE);
    return { ok: false, bars: [], asOfMs: Date.now(), status: res.status, error: `alpaca_paper_http_${res.status}` };
  }
  const json = (await res.json()) as { bars?: unknown[] };
  const bars = json.bars ?? [];
  const touch = Date.now();
  deskTouchFeed("alpaca_paper", touch, SOURCE);
  return { ok: true, bars, asOfMs: touch };
}