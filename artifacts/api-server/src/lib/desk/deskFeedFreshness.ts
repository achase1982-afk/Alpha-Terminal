import { getMarketContext } from "../getMarketContext.js";

export type DeskFeedId =
  | "schwab_quotes"
  | "schwab_chains"
  | "spx_tape"
  | "uw_flow"
  | "tradier"
  | "alpaca"
  | "news";

export type DeskFeedStatus = {
  feed: DeskFeedId;
  source: string;
  last_update_ts: string | null;
  age_ms: number | null;
  stale: boolean;
  error?: string;
  not_configured?: boolean;
};

type FeedRecord = {
  source: string;
  lastMs: number | null;
  error?: string;
  notConfigured?: boolean;
};

const records = new Map<DeskFeedId, FeedRecord>();

/** RTH stale thresholds (ms); extended hours use looser quote/tape thresholds. */
export const DESK_STALE_MS = {
  quotesRth: 15_000,
  quotesOffRth: 120_000,
  tapeRth: 15_000,
  tapeOffRth: 120_000,
  chains: 120_000,
  flow: 120_000,
  news: 15 * 60_000,
  tradierAlpaca: 120_000,
} as const;

function defaultSource(feed: DeskFeedId): string {
  switch (feed) {
    case "schwab_quotes":
    case "schwab_chains":
    case "spx_tape":
      return "schwab";
    case "uw_flow":
      return "unusual_whales";
    case "tradier":
      return "tradier";
    case "alpaca":
      return "alpaca";
    case "news":
      return "finnhub";
    default:
      return feed;
  }
}

export function deskMarkFeedNotConfigured(feed: DeskFeedId, source?: string): void {
  records.set(feed, {
    source: source ?? defaultSource(feed),
    lastMs: null,
    notConfigured: true,
  });
}

export function deskMarkFeedError(feed: DeskFeedId, error: string, source?: string): void {
  const prev = records.get(feed);
  records.set(feed, {
    source: source ?? prev?.source ?? defaultSource(feed),
    lastMs: prev?.lastMs ?? null,
    error,
    notConfigured: prev?.notConfigured,
  });
}

export function deskTouchFeed(feed: DeskFeedId, source?: string): void {
  const prev = records.get(feed);
  records.set(feed, {
    source: source ?? prev?.source ?? defaultSource(feed),
    lastMs: Date.now(),
    notConfigured: false,
  });
}

export function deskFeedStaleThresholdMs(feed: DeskFeedId, now = Date.now()): number {
  const session = getMarketContext(new Date(now)).session;
  const rth = session === "OPEN";
  switch (feed) {
    case "schwab_quotes":
      return rth ? DESK_STALE_MS.quotesRth : DESK_STALE_MS.quotesOffRth;
    case "spx_tape":
      return rth ? DESK_STALE_MS.tapeRth : DESK_STALE_MS.tapeOffRth;
    case "schwab_chains":
      return DESK_STALE_MS.chains;
    case "uw_flow":
      return DESK_STALE_MS.flow;
    case "news":
      return DESK_STALE_MS.news;
    case "tradier":
    case "alpaca":
      return DESK_STALE_MS.tradierAlpaca;
    default:
      return DESK_STALE_MS.chains;
  }
}

export function deskIsFeedStale(feed: DeskFeedId, lastMs: number | null, now = Date.now()): boolean {
  if (lastMs == null) return true;
  return now - lastMs > deskFeedStaleThresholdMs(feed, now);
}

export function buildDeskHealthFeeds(now = Date.now()): DeskFeedStatus[] {
  const ids: DeskFeedId[] = [
    "schwab_quotes",
    "schwab_chains",
    "spx_tape",
    "uw_flow",
    "tradier",
    "alpaca",
    "news",
  ];
  return ids.map((feed) => {
    const rec = records.get(feed) ?? { source: defaultSource(feed), lastMs: null };
    const lastMs = rec.lastMs;
    const age_ms = lastMs != null ? now - lastMs : null;
    const stale = rec.notConfigured ? false : deskIsFeedStale(feed, lastMs, now);
    const row: DeskFeedStatus = {
      feed,
      source: rec.source,
      last_update_ts: lastMs != null ? new Date(lastMs).toISOString() : null,
      age_ms,
      stale: rec.notConfigured ? false : stale || lastMs == null,
    };
    if (rec.error) row.error = rec.error;
    if (rec.notConfigured) row.not_configured = true;
    return row;
  });
}

/** Test helper */
export function deskResetFeedFreshnessForTests(): void {
  records.clear();
}