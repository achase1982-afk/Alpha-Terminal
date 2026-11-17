import { deskAsofEtIso, deskInEtTimeWindow, deskIsNyWeekday, deskSessionDateEt } from "./deskEt.js";
import {
  isEquityQuoteRestSessionActive,
  isEquityQuoteRthStaleWindow,
  isSpxDeskProductSessionActive,
} from "./deskFeedSessions.js";
import { deskReadStreamerConnected, deskReadStreamerStatus } from "./deskSchwabStreamerBridge.js";
import { deskCoercePollReceiptTs } from "./deskFeedTimestamp.js";
import {
  deskFeedIntentionallyUnconfigured,
  deskFeedExcludedFromHealthGate,
} from "./deskFeedHealthGate.js";
import { DESK_NEWS_POLL_MS } from "./deskPollCadence.js";

const NEWS_OK_NO_NEW_POLL_MS = DESK_NEWS_POLL_MS * 2 + 5_000;

export type DeskFeedId =
  | "schwab_streamer"
  | "schwab_quotes_rest"
  | "schwab_chains"
  | "live_gamma_0dte"
  | "live_gamma"
  | "live_net_prem"
  | "uw_flow"
  | "tradier"
  | "tradier_sandbox"
  | "alpaca"
  | "alpaca_paper"
  | "tastytrade"
  | "schwab2_rest"
  | "alphavantage"
  | "marketaux"
  | "stocknews"
  | "eodhd"
  | "news";

export type DeskFeedStatusCode =
  | "OK"
  | "streaming"
  | "stale"
  | "stopped"
  | "evicted_yielded"
  | "AUTH_FAIL"
  | "auth_error"
  | "not_authorized"
  | "configured"
  | "session_closed"
  | "error"
  | "reconnecting"
  | "not_configured"
  | "rate_limited"
  | "ok_no_new_articles"
  | "expired_or_unpaid";

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
  /** When true, this row is omitted from `/health` `feeds_summary` stale/failure gates. */
  excluded_from_health_gate?: boolean;
};

type FeedRecord = {
  source: string;
  lastDataMs: number | null;
  /** Wall-clock ms of last HTTP 2xx poll (Finnhub news). */
  lastPollOkMs?: number | null;
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
  live_gamma_0dte: "unusual_whales",
  live_gamma: "unusual_whales",
  live_net_prem: "unusual_whales",
  uw_flow: "unusual_whales",
  tradier: "tradier",
  tradier_sandbox: "tradier_sandbox",
  alpaca: "alpaca_news",
  alpaca_paper: "alpaca_paper",
  tastytrade: "tastytrade_dxlink",
  schwab2_rest: "schwab_rest_2",
  alphavantage: "alphavantage",
  marketaux: "marketaux",
  stocknews: "stocknews",
  eodhd: "eodhd",
  news: "finnhub",
};

type SessionWindow = { start: string; end: string };

const FEED_SESSION: Partial<Record<DeskFeedId, SessionWindow>> = {
  live_gamma_0dte: { start: "09:29:50", end: "16:00:50" },
  live_gamma: { start: "09:31:20", end: "16:00:20" },
  live_net_prem: { start: "09:31:20", end: "15:45:20" },
};

export function deskStaleAfterMs(feed: DeskFeedId, now = Date.now()): number {
  switch (feed) {
    case "schwab_streamer":
      return 90_000;
    case "schwab_quotes_rest":
      return isEquityQuoteRthStaleWindow(new Date(now)) ? 15_000 : 300_000;
    case "schwab_chains":
    case "live_gamma_0dte":
    case "live_gamma":
    case "live_net_prem":
      return 180_000;
    case "uw_flow":
    case "tradier":
      return 180_000;
    case "alpaca":
    case "alpaca_paper":
    case "tastytrade":
    case "alphavantage":
    case "marketaux":
    case "stocknews":
    case "eodhd":
    case "news":
      return 15 * 60_000;
    case "tradier_sandbox":
    case "schwab2_rest":
      return 24 * 60 * 60_000;
    default:
      return 180_000;
  }
}

function feedInSession(feed: DeskFeedId, now = new Date()): boolean {
  switch (feed) {
    case "schwab_streamer":
    case "schwab_chains":
      return isSpxDeskProductSessionActive(now);
    case "schwab_quotes_rest":
      return isEquityQuoteRestSessionActive(now);
    default:
      break;
  }
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
    lastPollOkMs: prev?.lastPollOkMs ?? null,
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

export function deskMarkFeedNotAuthorized(feed: DeskFeedId, error: string, source?: string): void {
  const prev = records.get(feed);
  records.set(feed, {
    source: source ?? prev?.source ?? FEED_SOURCES[feed],
    lastDataMs: prev?.lastDataMs ?? null,
    notConfigured: false,
    forcedStatus: "not_authorized",
    error,
  });
}

export function deskMarkFeedConfiguredKeys(feed: DeskFeedId, source?: string): void {
  records.set(feed, {
    source: source ?? FEED_SOURCES[feed],
    lastDataMs: null,
    notConfigured: false,
    forcedStatus: "configured",
  });
}

export function deskMarkFeedRateLimited(feed: DeskFeedId, error: string, source?: string): void {
  const prev = records.get(feed);
  records.set(feed, {
    source: source ?? prev?.source ?? FEED_SOURCES[feed],
    lastDataMs: prev?.lastDataMs ?? null,
    lastPollOkMs: prev?.lastPollOkMs ?? null,
    error,
    forcedStatus: "rate_limited",
  });
}

export function deskMarkFeedExpiredOrUnpaid(feed: DeskFeedId, error: string, source?: string): void {
  const prev = records.get(feed);
  records.set(feed, {
    source: source ?? prev?.source ?? FEED_SOURCES[feed],
    lastDataMs: prev?.lastDataMs ?? null,
    lastPollOkMs: prev?.lastPollOkMs ?? null,
    error,
    forcedStatus: "expired_or_unpaid",
  });
}

export function deskTouchFeedPollOk(feed: DeskFeedId, pollMs = Date.now(), source?: string): void {
  const prev = records.get(feed);
  records.set(feed, {
    source: source ?? prev?.source ?? FEED_SOURCES[feed],
    lastDataMs: prev?.lastDataMs ?? null,
    lastPollOkMs: pollMs,
    notConfigured: false,
    error: undefined,
    forcedStatus: undefined,
  });
}

export function deskGetFeedLastPollOkMs(feed: DeskFeedId): number | null {
  return records.get(feed)?.lastPollOkMs ?? null;
}

export function deskClearFeedForcedStatus(feed: DeskFeedId): void {
  const prev = records.get(feed);
  if (!prev) return;
  records.set(feed, {
    ...prev,
    forcedStatus: undefined,
    error: undefined,
  });
}

export function deskMarkFeedAuthError(feed: DeskFeedId, error: string, source?: string): void {
  const prev = records.get(feed);
  records.set(feed, {
    source: source ?? prev?.source ?? FEED_SOURCES[feed],
    lastDataMs: prev?.lastDataMs ?? null,
    lastPollOkMs: prev?.lastPollOkMs ?? null,
    error,
    forcedStatus: "auth_error",
  });
}

/** Set feed freshness from newest article time only (null when no articles). */
export function deskTouchFeedArticleAge(feed: DeskFeedId, articleMaxMs: number | null, source?: string): void {
  const prev = records.get(feed);
  records.set(feed, {
    source: source ?? prev?.source ?? FEED_SOURCES[feed],
    lastDataMs: articleMaxMs,
    lastPollOkMs: prev?.lastPollOkMs ?? null,
    notConfigured: false,
    forcedStatus: undefined,
    error: undefined,
  });
}

/** `dataTsMs` is the vendor timestamp of the payload when known; else wall clock. */
export function deskTouchFeed(feed: DeskFeedId, dataTsMs?: number, source?: string): void {
  const pollMs = Date.now();
  const ts = deskCoercePollReceiptTs(dataTsMs, pollMs);
  const prev = records.get(feed);
  records.set(feed, {
    source: source ?? prev?.source ?? FEED_SOURCES[feed],
    lastDataMs: ts,
    lastPollOkMs: prev?.lastPollOkMs ?? null,
    notConfigured: false,
    error: undefined,
    forcedStatus: undefined,
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
  if (feed === "news") {
    if (rec.notConfigured || rec.forcedStatus === "not_configured") return "not_configured";
    if (rec.forcedStatus === "auth_error") return "auth_error";
    if (rec.forcedStatus === "rate_limited") return "rate_limited";
    if (rec.forcedStatus === "error") return "error";
    const pollFresh =
      rec.lastPollOkMs != null && now - rec.lastPollOkMs <= NEWS_OK_NO_NEW_POLL_MS;
    if (!pollFresh) return "stale";
    const last = rec.lastDataMs;
    if (last == null) return "stale";
    if (deskIsFeedStale("news", last, now)) return "ok_no_new_articles";
    return "OK";
  }
  if (rec.notConfigured || rec.forcedStatus === "not_configured") return "not_configured";
  if (rec.forcedStatus === "not_authorized") return "not_authorized";
  if (rec.forcedStatus === "configured") return "configured";
  if (rec.forcedStatus === "AUTH_FAIL") return "AUTH_FAIL";
  if (rec.forcedStatus === "auth_error") return "auth_error";
  if (rec.forcedStatus === "rate_limited") return "rate_limited";
  if (rec.forcedStatus === "expired_or_unpaid") return "expired_or_unpaid";
  if (rec.forcedStatus === "error") return "error";
  if (!feedInSession(feed, at)) return "session_closed";

  if (feed === "schwab_streamer") return resolveStreamerStatus(now);
  if (rec.forcedStatus === "evicted_yielded") return "evicted_yielded";

  const last = rec.lastDataMs;
  const stale = deskIsFeedStale(feed, last, now);
  if (last == null) return "stale";
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
    "schwab2_rest",
    "live_gamma_0dte",
    "live_gamma",
    "live_net_prem",
    "uw_flow",
    "tradier",
    "tradier_sandbox",
    "alpaca",
    "alpaca_paper",
    "tastytrade",
    "alphavantage",
    "marketaux",
    "stocknews",
    "eodhd",
    "news",
  ];

  return ids.map((feed) => {
    let rec = records.get(feed) ?? { source: FEED_SOURCES[feed], lastDataMs: null };
    if (deskFeedIntentionallyUnconfigured(feed)) {
      rec = {
        source: FEED_SOURCES[feed],
        lastDataMs: null,
        notConfigured: true,
        forcedStatus: "not_configured",
      };
    }
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
      status !== "auth_error" &&
      status !== "not_authorized" &&
      status !== "rate_limited" &&
      status !== "expired_or_unpaid" &&
      status !== "ok_no_new_articles" &&
      status !== "configured" &&
      status !== "AUTH_FAIL" &&
      (status === "stale" || lastMs == null || deskIsFeedStale(feed, lastMs, now));
    if (status === "session_closed") stale = false;
    if (status === "not_configured") stale = false;
    if (status === "configured" || status === "not_authorized") stale = false;
    if (status === "rate_limited" || status === "expired_or_unpaid" || status === "ok_no_new_articles") {
      stale = false;
    }
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
    if (deskFeedExcludedFromHealthGate(row)) {
      row.excluded_from_health_gate = true;
      row.stale = false;
    }
    return row;
  });
}

export { deskSummarizeFeedsHealth } from "./deskFeedHealthGate.js";

export function deskResetFeedFreshnessForTests(): void {
  records.clear();
  streamerEvicted = false;
  streamerDisabled = false;
}

/** @deprecated use deskStaleAfterMs */
export const DESK_STALE_MS = { quotesRth: 15_000 } as const;
