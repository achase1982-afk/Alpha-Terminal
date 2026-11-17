import { deskSessionDateEt } from "../../deskEt.js";
import { deskUwExtractRows, DESK_UW_SNAPSHOT_TTL_MS } from "./deskUwGamma.js";
import { deskUwGet } from "./deskUwHttp.js";
import { deskTouchFeed } from "../../deskFeedFreshness.js";
import { getUwApiKey } from "./deskUnusualWhales.js";
import { logger } from "../../../logger.js";
import { deskApplyUwHttpFeedStatus, deskUwMarkNotConfigured } from "./deskUwStatus.js";

const UW_SOURCE = "unusual_whales";

export function deskParseTapeTimeMs(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw < 1e12 ? Math.floor(raw * 1000) : Math.floor(raw);
  }
  if (typeof raw !== "string" || !raw.trim()) return null;
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

export function deskFilterTicksSince(rows: unknown[], sinceMs: number | null): unknown[] {
  if (sinceMs == null) return rows;
  return rows.filter((row) => {
    if (!row || typeof row !== "object") return false;
    const r = row as Record<string, unknown>;
    const ms = deskParseTapeTimeMs(r.tape_time ?? r.timestamp ?? r.time);
    if (ms == null) return true;
    return ms >= sinceMs;
  });
}

type NetPremCache = {
  rows: unknown[];
  asOfMs: number;
  cachedAtMs: number;
  ticker: string;
  date: string;
};

const netPremCache = new Map<string, NetPremCache>();

function netPremKey(ticker: string, date: string): string {
  return `${ticker.toUpperCase()}|${date}`;
}

export async function deskRefreshNetPremTicks(ticker = "SPX", marketDate?: string): Promise<NetPremCache | null> {
  try {
    const key = getUwApiKey();
    if (!key) {
      deskUwMarkNotConfigured("live_net_prem");
      return null;
    }
    const sym = ticker.toUpperCase();
    const date = (marketDate ?? deskSessionDateEt()).slice(0, 10);
    const path = `/api/stock/${encodeURIComponent(sym)}/net-prem-ticks?date=${encodeURIComponent(date)}`;
    const res = await deskUwGet(path);
    if (!res.ok) {
      deskApplyUwHttpFeedStatus("live_net_prem", res.status, "unusual_whales", res.retryAfterSec);
      return null;
    }
    const rows = deskUwExtractRows(res.json);
    const cached: NetPremCache = {
      rows,
      asOfMs: res.asOfMs,
      cachedAtMs: Date.now(),
      ticker: sym,
      date,
    };
    netPremCache.set(netPremKey(sym, date), cached);
    deskTouchFeed("live_net_prem", res.asOfMs, UW_SOURCE);
    return cached;
  } catch (err) {
    deskApplyUwHttpFeedStatus("live_net_prem", 0);
    logger.debug({ err, ticker }, "Desk UW net-prem refresh error");
    return null;
  }
}

export function deskGetCachedNetPremTicks(
  ticker: string,
  marketDate: string,
  sinceMs: number | null,
): { ticks: unknown[]; asOfMs: number; ticker: string } | null {
  const hit = netPremCache.get(netPremKey(ticker, marketDate.slice(0, 10)));
  if (!hit || Date.now() - hit.cachedAtMs > DESK_UW_SNAPSHOT_TTL_MS) return null;
  const ticks = deskFilterTicksSince(hit.rows, sinceMs);
  return { ticks, asOfMs: hit.asOfMs, ticker: hit.ticker };
}

export function deskResetNetPremCacheForTests(): void {
  netPremCache.clear();
}