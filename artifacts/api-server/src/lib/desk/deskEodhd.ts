import { deskEnv } from "./deskEnv.js";
import {
  deskMarkFeedAuthError,
  deskMarkFeedError,
  deskMarkFeedNotConfigured,
  deskTouchFeed,
} from "./deskFeedFreshness.js";
import { logger } from "../logger.js";

const SOURCE = "eodhd";

export function getEodhdKey(): string {
  return deskEnv("EODHD_API_KEY");
}

export async function deskProbeEodhd(): Promise<void> {
  const key = getEodhdKey();
  if (!key) {
    deskMarkFeedNotConfigured("eodhd", SOURCE);
    return;
  }
  try {
    const url = `https://eodhd.com/api/eod/SPY.US?fmt=json&limit=1&api_token=${encodeURIComponent(key)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (res.status === 401 || res.status === 403) {
      deskMarkFeedAuthError("eodhd", `eodhd_http_${res.status}`, SOURCE);
      return;
    }
    if (!res.ok) {
      deskMarkFeedError("eodhd", `eodhd_http_${res.status}`, SOURCE);
      return;
    }
    deskTouchFeed("eodhd", Date.now(), SOURCE);
  } catch (err) {
    deskMarkFeedError("eodhd", "eodhd_probe_error", SOURCE);
    logger.warn({ err }, "Desk EODHD probe failed");
  }
}

export async function deskFetchEodhdBars(
  symbol: string,
  limit: number,
): Promise<{ ok: boolean; bars: unknown[]; asOfMs: number; status?: number; error?: string }> {
  const key = getEodhdKey();
  if (!key) {
    deskMarkFeedNotConfigured("eodhd", SOURCE);
    return { ok: false, bars: [], asOfMs: Date.now(), status: 503, error: "not_configured" };
  }
  const sym = symbol.trim().toUpperCase();
  const eodSymbol = sym.includes(".") ? sym : `${sym}.US`;
  const url = `https://eodhd.com/api/eod/${encodeURIComponent(eodSymbol)}?fmt=json&limit=${limit}&api_token=${encodeURIComponent(key)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (res.status === 401 || res.status === 403) {
    const err = `eodhd_http_${res.status}`;
    deskMarkFeedAuthError("eodhd", err, SOURCE);
    return { ok: false, bars: [], asOfMs: Date.now(), status: res.status, error: err };
  }
  if (!res.ok) {
    deskMarkFeedError("eodhd", `eodhd_http_${res.status}`, SOURCE);
    return { ok: false, bars: [], asOfMs: Date.now(), status: res.status, error: `eodhd_http_${res.status}` };
  }
  const json = await res.json();
  const bars = Array.isArray(json) ? json : [];
  const touch = Date.now();
  deskTouchFeed("eodhd", touch, SOURCE);
  return { ok: true, bars, asOfMs: touch };
}