import { deskSessionDateEt } from "./deskEt.js";
import { deskUwGet } from "./deskUwHttp.js";
import {
  deskMarkFeedError,
  deskMarkFeedNotConfigured,
  deskTouchFeed,
  type DeskFeedId,
} from "./deskFeedFreshness.js";
import { getUwApiKey } from "./deskUnusualWhales.js";
import { logger } from "../logger.js";

const UW_SOURCE = "unusual_whales";
const PAGE_LIMIT = 500;

export function deskUwNormalizeExpiry(raw: string | undefined): string {
  if (raw?.trim()) return raw.trim().slice(0, 10);
  return deskSessionDateEt();
}

export function deskUwRowExpiry(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const v = r.expiry ?? r.expiration ?? r.exp_date ?? r.expiration_date ?? r.date;
  if (typeof v === "string") return v.slice(0, 10);
  return null;
}

export function deskUwFilterByExpiry(rows: unknown[], expiry: string): unknown[] {
  const want = expiry.slice(0, 10);
  return rows.filter((row) => deskUwRowExpiry(row) === want);
}

export function deskUwExtractRows(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    if (Array.isArray(o.data)) return o.data;
    if (Array.isArray(o.rows)) return o.rows;
  }
  return [];
}

/** UW list endpoints: `limit=500`, zero-based `page`. */
export async function deskUwFetchAllPages(
  path: string,
  limit = PAGE_LIMIT,
): Promise<{ ok: boolean; status: number; rows: unknown[]; asOfMs: number }> {
  const rows: unknown[] = [];
  let page = 0;
  let asOfMs = Date.now();
  let ok = true;
  let status = 200;
  const sep = path.includes("?") ? "&" : "?";

  while (page < 64) {
    const res = await deskUwGet(`${path}${sep}limit=${limit}&page=${page}`);
    asOfMs = res.asOfMs;
    if (!res.ok) {
      ok = false;
      status = res.status;
      break;
    }
    const batch = deskUwExtractRows(res.json);
    if (!batch.length) break;
    rows.push(...batch);
    if (batch.length < limit) break;
    page += 1;
  }
  return { ok, status, rows, asOfMs };
}

export type DeskUwGammaSnapshot = {
  data: { data: unknown[]; expiry: string; ticker: string };
  asOfMs: number;
  row_count: number;
  expiry: string;
  ticker: string;
};

const gamma0dteCache = new Map<string, DeskUwGammaSnapshot>();
const liveGammaCache = new Map<string, DeskUwGammaSnapshot>();

function cacheKey(ticker: string, expiry: string): string {
  return `${ticker.toUpperCase()}|${expiry.slice(0, 10)}`;
}

async function touchFeed(feed: DeskFeedId, asOfMs: number): Promise<void> {
  deskTouchFeed(feed, asOfMs, UW_SOURCE);
}

export async function deskFetchLiveGamma0dte(
  expiry: string,
  ticker = "SPX",
): Promise<DeskUwGammaSnapshot | null> {
  const key = getUwApiKey();
  if (!key) {
    deskMarkFeedNotConfigured("live_gamma_0dte", UW_SOURCE);
    return null;
  }
  const exp = deskUwNormalizeExpiry(expiry);
  const sym = ticker.toUpperCase();
  const path = `/api/stock/${encodeURIComponent(sym)}/spot-exposures/expiry-strike`;
  const res = await deskUwFetchAllPages(path);
  if (!res.ok) {
    deskMarkFeedError("live_gamma_0dte", `uw_http_${res.status}`, UW_SOURCE);
    logger.debug({ status: res.status }, "Desk UW live_gamma_0dte fetch failed");
    return null;
  }
  const filtered = deskUwFilterByExpiry(res.rows, exp);
  const snap: DeskUwGammaSnapshot = {
    data: { data: filtered, expiry: exp, ticker: sym },
    asOfMs: res.asOfMs,
    row_count: filtered.length,
    expiry: exp,
    ticker: sym,
  };
  gamma0dteCache.set(cacheKey(sym, exp), snap);
  await touchFeed("live_gamma_0dte", res.asOfMs);
  return snap;
}

export async function deskFetchLiveGamma(
  expiry: string,
  ticker = "SPX",
): Promise<DeskUwGammaSnapshot | null> {
  const key = getUwApiKey();
  if (!key) {
    deskMarkFeedNotConfigured("live_gamma", UW_SOURCE);
    return null;
  }
  const exp = deskUwNormalizeExpiry(expiry);
  const sym = ticker.toUpperCase();
  const path = `/api/stock/${encodeURIComponent(sym)}/spot-exposures`;
  const res = await deskUwFetchAllPages(path);
  if (!res.ok) {
    deskMarkFeedError("live_gamma", `uw_http_${res.status}`, UW_SOURCE);
    logger.debug({ status: res.status }, "Desk UW live_gamma fetch failed");
    return null;
  }
  const filtered = deskUwFilterByExpiry(res.rows, exp);
  const snap: DeskUwGammaSnapshot = {
    data: { data: filtered, expiry: exp, ticker: sym },
    asOfMs: res.asOfMs,
    row_count: filtered.length,
    expiry: exp,
    ticker: sym,
  };
  liveGammaCache.set(cacheKey(sym, exp), snap);
  await touchFeed("live_gamma", res.asOfMs);
  return snap;
}

export function deskGetCachedLiveGamma0dte(expiry: string, ticker = "SPX"): DeskUwGammaSnapshot | null {
  return gamma0dteCache.get(cacheKey(ticker.toUpperCase(), deskUwNormalizeExpiry(expiry))) ?? null;
}

export function deskGetCachedLiveGamma(expiry: string, ticker = "SPX"): DeskUwGammaSnapshot | null {
  return liveGammaCache.get(cacheKey(ticker.toUpperCase(), deskUwNormalizeExpiry(expiry))) ?? null;
}

/** Snapshot shape for legacy `getDeskUwFeedSnapshot`. */
export function deskUwGammaAsFeedSnapshot(snap: DeskUwGammaSnapshot): {
  data: unknown;
  asOfMs: number;
  row_count: number;
} {
  return { data: snap.data, asOfMs: snap.asOfMs, row_count: snap.row_count };
}

export function deskUwResetGammaCachesForTests(): void {
  gamma0dteCache.clear();
  liveGammaCache.clear();
}