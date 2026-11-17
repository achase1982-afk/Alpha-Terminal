import { deskEnv } from "./deskEnv.js";
import {
  deskMarkFeedAuthError,
  deskMarkFeedError,
  deskMarkFeedNotConfigured,
  deskTouchFeed,
} from "./deskFeedFreshness.js";
import { logger } from "../logger.js";

const SOURCE = "marketaux";

export function getMarketauxKey(): string {
  return deskEnv("MARKETAUX_API_KEY");
}

export async function deskProbeMarketaux(): Promise<void> {
  const key = getMarketauxKey();
  if (!key) {
    deskMarkFeedNotConfigured("marketaux", SOURCE);
    return;
  }
  try {
    const url = `https://api.marketaux.com/v1/news/all?symbols=SPY&filter_entities=true&limit=1&api_token=${encodeURIComponent(key)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (res.status === 401 || res.status === 403) {
      deskMarkFeedAuthError("marketaux", `marketaux_http_${res.status}`, SOURCE);
      return;
    }
    if (!res.ok) {
      deskMarkFeedError("marketaux", `marketaux_http_${res.status}`, SOURCE);
      return;
    }
    deskTouchFeed("marketaux", Date.now(), SOURCE);
  } catch (err) {
    deskMarkFeedError("marketaux", "marketaux_probe_error", SOURCE);
    logger.warn({ err }, "Desk Marketaux probe failed");
  }
}

export async function deskFetchMarketauxNews(
  symbols: string[],
): Promise<{ ok: boolean; articles: unknown[]; asOfMs: number; status?: number; error?: string }> {
  const key = getMarketauxKey();
  if (!key) {
    deskMarkFeedNotConfigured("marketaux", SOURCE);
    return { ok: false, articles: [], asOfMs: Date.now(), status: 503, error: "not_configured" };
  }
  const sym = symbols.map((s) => s.trim().toUpperCase()).filter(Boolean).join(",") || "SPY";
  const url = `https://api.marketaux.com/v1/news/all?symbols=${encodeURIComponent(sym)}&filter_entities=true&limit=50&api_token=${encodeURIComponent(key)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (res.status === 401 || res.status === 403) {
    const err = `marketaux_http_${res.status}`;
    deskMarkFeedAuthError("marketaux", err, SOURCE);
    return { ok: false, articles: [], asOfMs: Date.now(), status: res.status, error: err };
  }
  if (!res.ok) {
    deskMarkFeedError("marketaux", `marketaux_http_${res.status}`, SOURCE);
    return { ok: false, articles: [], asOfMs: Date.now(), status: res.status, error: `marketaux_http_${res.status}` };
  }
  const json = (await res.json()) as { data?: unknown[] };
  const articles = json.data ?? [];
  const touch = Date.now();
  deskTouchFeed("marketaux", touch, SOURCE);
  return { ok: true, articles, asOfMs: touch };
}