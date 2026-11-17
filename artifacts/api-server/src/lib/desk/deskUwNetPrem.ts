import { deskUwExtractRows } from "./deskUwGamma.js";
import { deskUwGet } from "./deskUwHttp.js";
import {
  deskMarkFeedError,
  deskMarkFeedNotConfigured,
  deskTouchFeed,
} from "./deskFeedFreshness.js";
import { getUwApiKey } from "./deskUnusualWhales.js";
import { logger } from "../logger.js";

const UW_SOURCE = "unusual_whales";

export function deskParseSinceMs(raw: string | undefined): number | null {
  if (raw == null || String(raw).trim() === "") return null;
  const s = String(raw).trim();
  const n = Number(s);
  if (Number.isFinite(n)) {
    if (n > 1e12) return Math.floor(n);
    if (n > 1e9) return Math.floor(n * 1000);
  }
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? parsed : null;
}

export function deskFilterTicksSince(rows: unknown[], sinceMs: number | null): unknown[] {
  if (sinceMs == null) return rows;
  return rows.filter((row) => {
    if (!row || typeof row !== "object") return false;
    const r = row as Record<string, unknown>;
    const t =
      typeof r.timestamp === "number"
        ? r.timestamp
        : typeof r.tape_time === "number"
          ? r.tape_time
          : typeof r.time === "string"
            ? Date.parse(r.time)
            : NaN;
    if (!Number.isFinite(t)) return true;
    const ms = t < 1e12 ? t * 1000 : t;
    return ms >= sinceMs;
  });
}

export type DeskUwNetPremResult = {
  ok: boolean;
  ticks: unknown[];
  asOfMs: number;
  ticker: string;
  status?: number;
  error?: string;
};

export async function deskFetchNetPremTicks(opts?: {
  ticker?: string;
  sinceMs?: number | null;
}): Promise<DeskUwNetPremResult> {
  const key = getUwApiKey();
  if (!key) {
    deskMarkFeedNotConfigured("live_net_prem", UW_SOURCE);
    return { ok: false, ticks: [], asOfMs: Date.now(), ticker: "SPX", error: "not_configured" };
  }
  const ticker = (opts?.ticker ?? "SPX").toUpperCase();
  let path = `/api/stock/${encodeURIComponent(ticker)}/net-prem-ticks`;
  if (opts?.sinceMs != null) {
    path += `?since=${encodeURIComponent(String(opts.sinceMs))}`;
  }
  try {
    const res = await deskUwGet(path);
    if (!res.ok) {
      deskMarkFeedError("live_net_prem", `uw_http_${res.status}`, UW_SOURCE);
      return {
        ok: false,
        ticks: [],
        asOfMs: res.asOfMs,
        ticker,
        status: res.status,
        error: `uw_http_${res.status}`,
      };
    }
    const rows = deskUwExtractRows(res.json);
    const ticks = deskFilterTicksSince(rows, opts?.sinceMs ?? null);
    deskTouchFeed("live_net_prem", res.asOfMs, UW_SOURCE);
    return { ok: true, ticks, asOfMs: res.asOfMs, ticker };
  } catch (err) {
    deskMarkFeedError("live_net_prem", "uw_fetch_error", UW_SOURCE);
    logger.debug({ err, ticker }, "Desk UW net-prem ticks error");
    return { ok: false, ticks: [], asOfMs: Date.now(), ticker, error: "uw_fetch_error" };
  }
}