import { deskEnv } from "./deskEnv.js";
import {
  deskTouchFeed,
  deskMarkFeedNotConfigured,
  deskMarkFeedError,
  deskMarkFeedAuthError,
} from "./deskFeedFreshness.js";
import { logger } from "../logger.js";
import { classShareForVendor, classShareToDot } from "../classShareSymbology.js";

const TRADIER_BASE = "https://api.tradier.com/v1";

export function getTradierToken(): string {
  return deskEnv("TRADIER_API_KEY", "TRADIER_TOKEN");
}

export async function deskTradierQuotes(symbols: string[]): Promise<{
  ok: boolean;
  status: number;
  quotes: Record<string, unknown>[];
  asOfMs: number;
  error?: string;
}> {
  const token = getTradierToken();
  if (!token) {
    deskMarkFeedNotConfigured("tradier");
    return { ok: false, status: 503, quotes: [], asOfMs: Date.now(), error: "not_configured" };
  }

  const requested = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const apiSyms = requested.map((s) => classShareForVendor(s, "tradier"));
  const sym = apiSyms.join(",");
  const url = `${TRADIER_BASE}/markets/quotes?symbols=${encodeURIComponent(sym)}&greeks=false`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (res.status === 401 || res.status === 403) {
    const err = `tradier_http_${res.status}`;
    deskMarkFeedAuthError("tradier", err, "tradier");
    logger.warn({ status: res.status }, "Desk Tradier quotes auth failed");
    return { ok: false, status: res.status, quotes: [], asOfMs: Date.now(), error: err };
  }
  if (!res.ok) {
    const err = `tradier_http_${res.status}`;
    deskMarkFeedError("tradier", err);
    logger.warn({ status: res.status }, "Desk Tradier quotes HTTP failed");
    return { ok: false, status: res.status, quotes: [], asOfMs: Date.now(), error: err };
  }
  const json = (await res.json()) as { quotes?: { quote?: unknown } };
  const q = json.quotes?.quote;
  const list = q == null ? [] : Array.isArray(q) ? q : [q];
  const byApi = new Map<string, Record<string, unknown>>();
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const api = String((row as Record<string, unknown>).symbol ?? "").toUpperCase();
    if (api) byApi.set(api, row as Record<string, unknown>);
  }
  const quotes: Record<string, unknown>[] = [];
  for (let i = 0; i < requested.length; i++) {
    const display = requested[i]!;
    const api = apiSyms[i]!;
    const row =
      byApi.get(api) ??
      byApi.get(classShareToDot(api)) ??
      (list[i] as Record<string, unknown> | undefined);
    if (row) quotes.push({ ...row, symbol: display });
  }
  const asOfMs = Date.now();
  deskTouchFeed("tradier", asOfMs, "tradier");
  return { ok: true, status: res.status, quotes, asOfMs };
}