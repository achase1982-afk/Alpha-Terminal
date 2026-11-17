import { deskSessionDateEt } from "../../deskEt.js";
import { deskUwGet } from "./deskUwHttp.js";
import { deskTouchFeed, type DeskFeedId } from "../../deskFeedFreshness.js";
import { getUwApiKey } from "./deskUnusualWhales.js";
import { logger } from "../../../logger.js";
import { deskApplyUwHttpFeedStatus, deskUwMarkNotConfigured } from "./deskUwStatus.js";

const UW_SOURCE = "unusual_whales";
const PAGE_LIMIT = 500;
/** Short TTL for route cache serves (poller refreshes on its own cadence). */
export const DESK_UW_SNAPSHOT_TTL_MS = 120_000;

export function deskUwNormalizeExpiry(raw: string | undefined): string {
  if (raw?.trim()) return raw.trim().slice(0, 10);
  return deskSessionDateEt();
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

export async function deskUwFetchExpiryStrikePages(
  ticker: string,
  marketDate: string,
  expiry: string,
): Promise<{ ok: boolean; status: number; rows: unknown[]; asOfMs: number; retryAfterSec?: number }> {
  const rows: unknown[] = [];
  let page = 0;
  let asOfMs = Date.now();
  let ok = true;
  let status = 200;
  let retryAfterSec: number | undefined;

  while (page < 64) {
    const params = new URLSearchParams();
    params.append("expirations[]", expiry);
    params.set("date", marketDate);
    params.set("limit", String(PAGE_LIMIT));
    params.set("page", String(page));
    const path = `/api/stock/${encodeURIComponent(ticker)}/spot-exposures/expiry-strike?${params.toString()}`;
    const res = await deskUwGet(path);
    asOfMs = res.asOfMs;
    if (!res.ok) {
      ok = false;
      status = res.status;
      retryAfterSec = res.retryAfterSec;
      break;
    }
    const batch = deskUwExtractRows(res.json);
    if (!batch.length) break;
    rows.push(...batch);
    if (batch.length < PAGE_LIMIT) break;
    page += 1;
  }
  return { ok, status, rows, asOfMs, retryAfterSec };
}

export type DeskUwGammaSnapshot = {
  data: { data: unknown[]; date: string; expiry?: string; ticker: string };
  asOfMs: number;
  cachedAtMs: number;
  row_count: number;
  date: string;
  expiry?: string;
  ticker: string;
  lastUwStatus?: number;
  error?: string;
};

const gamma0dteCache = new Map<string, DeskUwGammaSnapshot>();
const liveGammaCache = new Map<string, DeskUwGammaSnapshot>();

function cacheKey(ticker: string, dateOrExpiry: string, kind: "0dte" | "live"): string {
  return `${kind}|${ticker.toUpperCase()}|${dateOrExpiry.slice(0, 10)}`;
}

function touchFeed(feed: DeskFeedId, asOfMs: number): void {
  deskTouchFeed(feed, asOfMs, UW_SOURCE);
}

function snapshotFresh(snap: DeskUwGammaSnapshot | null | undefined): snap is DeskUwGammaSnapshot {
  if (!snap) return false;
  return Date.now() - snap.cachedAtMs < DESK_UW_SNAPSHOT_TTL_MS;
}

export async function deskRefreshLiveGamma0dte(
  expiry: string,
  ticker = "SPX",
): Promise<DeskUwGammaSnapshot | null> {
  try {
    const key = getUwApiKey();
    if (!key) {
      deskUwMarkNotConfigured("live_gamma_0dte");
      return null;
    }
    const exp = deskUwNormalizeExpiry(expiry);
    const sym = ticker.toUpperCase();
    const marketDate = deskSessionDateEt(new Date());
    const res = await deskUwFetchExpiryStrikePages(sym, marketDate, exp);
    if (!res.ok) {
      deskApplyUwHttpFeedStatus("live_gamma_0dte", res.status, "unusual_whales", res.retryAfterSec);
      logger.debug({ status: res.status }, "Desk UW live_gamma_0dte fetch failed");
      return null;
    }
    const now = Date.now();
    const snap: DeskUwGammaSnapshot = {
      data: { data: res.rows, date: marketDate, expiry: exp, ticker: sym },
      asOfMs: res.asOfMs,
      cachedAtMs: now,
      row_count: res.rows.length,
      date: marketDate,
      expiry: exp,
      ticker: sym,
    };
    gamma0dteCache.set(cacheKey(sym, exp, "0dte"), snap);
    touchFeed("live_gamma_0dte", res.asOfMs);
    return snap;
  } catch (err) {
    deskApplyUwHttpFeedStatus("live_gamma_0dte", 0);
    logger.debug({ err }, "Desk UW live_gamma_0dte error");
    return null;
  }
}

export async function deskRefreshLiveGamma(marketDate: string, ticker = "SPX"): Promise<DeskUwGammaSnapshot | null> {
  try {
    const key = getUwApiKey();
    if (!key) {
      deskUwMarkNotConfigured("live_gamma");
      return null;
    }
    const sym = ticker.toUpperCase();
    const path = `/api/stock/${encodeURIComponent(sym)}/spot-exposures?date=${encodeURIComponent(marketDate)}`;
    const res = await deskUwGet(path);
    if (!res.ok) {
      deskApplyUwHttpFeedStatus("live_gamma", res.status, "unusual_whales", res.retryAfterSec);
      logger.debug({ status: res.status }, "Desk UW live_gamma fetch failed");
      return null;
    }
    const rows = deskUwExtractRows(res.json);
    const now = Date.now();
    const snap: DeskUwGammaSnapshot = {
      data: { data: rows, date: marketDate, ticker: sym },
      asOfMs: res.asOfMs,
      cachedAtMs: now,
      row_count: rows.length,
      date: marketDate,
      ticker: sym,
    };
    liveGammaCache.set(cacheKey(sym, marketDate, "live"), snap);
    touchFeed("live_gamma", res.asOfMs);
    return snap;
  } catch (err) {
    deskApplyUwHttpFeedStatus("live_gamma", 0);
    logger.debug({ err }, "Desk UW live_gamma error");
    return null;
  }
}

export function deskGetCachedLiveGamma0dte(
  expiry: string,
  ticker = "SPX",
): DeskUwGammaSnapshot | null {
  const snap = gamma0dteCache.get(cacheKey(ticker.toUpperCase(), deskUwNormalizeExpiry(expiry), "0dte"));
  return snapshotFresh(snap) ? snap : null;
}

export function deskGetCachedLiveGamma(marketDate: string, ticker = "SPX"): DeskUwGammaSnapshot | null {
  const snap = liveGammaCache.get(cacheKey(ticker.toUpperCase(), marketDate.slice(0, 10), "live"));
  return snapshotFresh(snap) ? snap : null;
}

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
