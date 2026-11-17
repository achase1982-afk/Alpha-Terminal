import { getMarketContext } from "../getMarketContext.js";
import { deskAsofEtIso, deskInEtTimeWindow, deskIsNyWeekday, deskSessionDateEt } from "./deskEt.js";
import { deskReadStreamerConnected, deskReadStreamerStatus } from "./deskSchwabStreamerBridge.js";

export type DeskFeedId =
  | "schwab_streamer"
  | "schwab_quotes_rest"
  | "schwab_chains"
  | "live_gamma_0dte"
  | "live_gamma"
  | "live_net_prem"
  | "uw_flow"
  | "tradier"
  | "alpaca"
  | "news";

export type DeskFeedStatusCode =
  | "OK"
  | "streaming"
  | "stale"
  | "stopped"
  | "evicted_yielded"
  | "AUTH_FAIL"
  | "session_closed"
  | "error"
  | "reconnecting"
  | "not_configured";

export type DeskFeedStatus = {
  feed: DeskFeedId;
  source: string;
  /** UTC ms of last market-data timestamp (not clock time). */
  last_update_ts: number | null;
  age_ms: number | null;
  stale: boolean;
  stale_after_ms: number;
  status: DeskFeedStatusCode;
  session_date: string;
  asof_et: string;
  error?: string;
};

type FeedRecord = {
  source: string;
  lastDataMs: number | null;
  error?: string;
  notConfigured?: boolean;
  forcedStatus?: DeskFeedStatusCode;
};

const records = new Map<DeskFeedId, FeedRecord>();

let streamerEvicted = false;
let streamerDisabled = false;

const FEED_SOURCES: Record<DeskFeedId, string> = {
  schwab_streamer: "schwab",
  schwab_quotes_rest: "schwab",
  schwab_chains: "schwab",
  live_gamma_0dte: "schwab",
  live_gamma: "schwab",
  live_net_prem: "schwab",
  uw_flow: "unusual_whales",
  tradier: "tradier",
  alpaca: "alpaca_news",
  news: "finnhub",
};

type SessionWindow = { start: string; end: string };

const FEED_SESSION: Partial<Record<DeskFeedId, SessionWindow>> = {
  live_gamma_0dte: { start: "09:29:50", end: "16:00:50" },
  live_gamma: { start: "09:31:20", end: "16:00:20" },
  live_net_prem: { start: "09:31:20", end: "15:45:20" },
};

export function deskStaleAfterMs(feed: DeskFeedId, now = Date.now()): number {
  const session = getMarketContext(new Date(now)).session;
  const rth = session === "OPEN";
  switch (feed) {
    case "schwab_streamer":
      return 90_000;
    case "schwab_quotes_rest":
      return rth ? 15_000 : 300_000;
    case "schwab_chains":
    case "live_gamma_0dte":
    case "live_gamma":
    case "live_net_prem":
      return 180_000;
    case "uw_flow":
    case "tradier":
      return 180_000;
    case "alpaca":
    case "news":
      return 15 * 60_000;
    default:
      return 180_000;
  }
}

function feedInSession(feed: DeskFeedId, now = new Date()): boolean {
  const win = FEED_SESSION[feed];
  if (!win) return true;
  if (!deskIsNyWeekday(now)) return false;
  return deskInEtTimeWindow(win.start, win.end, now);
}

export function deskSetStreamerDisabled(disabled: boolean): void {
  streamerDisabled = disabled;
}

export function deskMarkStreamerEvicted(): void {
  streamerEvicted = true;
  records.set("schwab_streamer", {
    source: "schwab",
    lastDataMs: records.get("schwab_streamer")?.lastDataMs ?? null,
    forcedStatus: "evicted_yielded",
  });
}

export function deskClearStreamerEvicted(): void {
  streamerEvicted = false;
  const rec = records.get("schwab_streamer");
  if (rec?.forcedStatus === "evicted_yielded") {
    delete rec.forcedStatus;
  }
}

export function deskMarkFeedNotConfigured(feed: DeskFeedId, source?: string): void {
  records.set(feed, {
    source: source ?? FEED_SOURCES[feed],
    lastDataMs: null,
    notConfigured: true,
    forcedStatus: "not_configured",
  });
}

export function deskMarkFeedError(feed: DeskFeedId, error: string, source?: string): void {
  const prev = records.get(feed);
  records.set(feed, {
    source: source ?? prev?.source ?? FEED_SOURCES[feed],
    lastDataMs: prev?.lastDataMs ?? null,
    error,
    forcedStatus: "error",
  });
}

export function deskMarkAuthFail(feed: DeskFeedId): void {
  const prev = records.get(feed);
  records.set(feed, {
    source: prev?.source ?? FEED_SOURCES[feed],
    lastDataMs: prev?.lastDataMs ?? null,
    forcedStatus: "AUTH_FAIL",
    error: "auth_fail",
  });
}

/** `dataTsMs` is the vendor timestamp of the payload when known; else wall clock. */
export function deskTouchFeed(feed: DeskFeedId, dataTsMs?: number, source?: string): void {
  const ts = dataTsMs ?? Date.now();
  const prev = records.get(feed);
  records.set(feed, {
    source: source ?? prev?.source ?? FEED_SOURCES[feed],
    lastDataMs: ts,
    notConfigured: false,
  });
}

export function deskIsFeedStale(feed: DeskFeedId, lastMs: number | null, now = Date.now()): boolean {
  if (lastMs == null) return true;
  return now - lastMs > deskStaleAfterMs(feed, now);
}

function resolveStreamerStatus(now: number): DeskFeedStatusCode {
  if (streamerDisabled) return "stopped";
  if (streamerEvicted) return "evicted_yielded";
  const st = deskReadStreamerStatus();
  if (st === "connecting") return "reconnecting";
  if (st === "connected") {
    const last = records.get("schwab_streamer")?.lastDataMs;
    if (last != null && !deskIsFeedStale("schwab_streamer", last, now)) return "streaming";
    return deskReadStreamerConnected() ? "OK" : "error";
  }
  return "stopped";
}

function resolveStatus(
  feed: DeskFeedId,
  rec: FeedRecord,
  now: number,
): DeskFeedStatusCode {
  const at = new Date(now);
  if (rec.notConfigured || rec.forcedStatus === "not_configured") return "not_configured";
  if (rec.forcedStatus === "AUTH_FAIL") return "AUTH_FAIL";
  if (rec.forcedStatus === "error") return "error";
  if (!feedInSession(feed, at)) return "session_closed";

  if (feed === "schwab_streamer") return resolveStreamerStatus(now);
  if (rec.forcedStatus === "evicted_yielded") return "evicted_yielded";

  const last = rec.lastDataMs;
  const stale = deskIsFeedStale(feed, last, now);
  if (last == null) {
    if (feed === "live_gamma_0dte" || feed === "live_gamma" || feed === "live_net_prem") return "stopped";
    return "stale";
  }
  if (stale) return "stale";
  return "OK";
}

export function buildDeskHealthFeeds(now = Date.now()): DeskFeedStatus[] {
  const session_date = deskSessionDateEt(new Date(now));
  const asof_et = deskAsofEtIso(new Date(now));
  const ids: DeskFeedId[] = [
    "schwab_streamer",
    "schwab_quotes_rest",
    "schwab_chains",
    "live_gamma_0dte",
    "live_gamma",
    "live_net_prem",
    "uw_flow",
    "tradier",
    "alpaca",
    "news",
  ];

  return ids.map((feed) => {
    const rec = records.get(feed) ?? { source: FEED_SOURCES[feed], lastDataMs: null };
    const lastMs = rec.lastDataMs;
    const age_ms = lastMs != null ? now - lastMs : null;
    const at = new Date(now);
    const status = resolveStatus(feed, rec, now);
    const inSession = feedInSession(feed, at);
    const staleAfter = deskStaleAfterMs(feed, now);
    let stale =
      status !== "not_configured" &&
      status !== "session_closed" &&
      status !== "stopped" &&
      (status === "stale" || lastMs == null || deskIsFeedStale(feed, lastMs, now));
    if (status === "session_closed") stale = false;
    if (status === "not_configured") stale = false;
    if (!inSession && FEED_SESSION[feed]) stale = false;

    const row: DeskFeedStatus = {
      feed,
      source: rec.source,
      last_update_ts: lastMs,
      age_ms,
      stale,
      stale_after_ms: staleAfter,
      status,
      session_date,
      asof_et,
    };
    if (rec.error) row.error = rec.error;
    return row;
  });
}

export function deskResetFeedFreshnessForTests(): void {
  records.clear();
  streamerEvicted = false;
  streamerDisabled = false;
}

/** @deprecated use deskStaleAfterMs */
export const DESK_STALE_MS = { quotesRth: 15_000 } as const;