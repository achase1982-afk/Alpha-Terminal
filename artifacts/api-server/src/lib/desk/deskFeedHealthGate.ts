import { getStocknewsKey } from "./deskStocknews.js";

type FeedRow = { feed: string; status: string; stale: boolean };

const UW_FEEDS = new Set(["live_gamma_0dte", "live_gamma", "live_net_prem", "uw_flow"]);
const UW_OPTIONAL_STATUSES = new Set([
  "not_configured",
  "rate_limited",
  "auth_error",
  "expired_or_unpaid",
]);

/** Feeds intentionally left unconfigured must not affect aggregate desk health. */
export function deskFeedIntentionallyUnconfigured(feed: string): boolean {
  if (feed === "stocknews") return !getStocknewsKey();
  return false;
}

/** When any UW feed is in billing/auth failure, all UW rows are gated off aggregates. */
export function deskUwAuthBackoffActive(feeds: FeedRow[]): boolean {
  return feeds.some(
    (f) => UW_FEEDS.has(f.feed) && (f.status === "auth_error" || f.status === "expired_or_unpaid"),
  );
}

export function deskFeedExcludedFromHealthGate(
  row: FeedRow,
  opts?: { uwAuthBackoff?: boolean },
): boolean {
  if (opts?.uwAuthBackoff && UW_FEEDS.has(row.feed)) return true;
  if (row.feed === "stocknews" && row.status === "not_configured") return true;
  if (UW_FEEDS.has(row.feed) && UW_OPTIONAL_STATUSES.has(row.status)) return true;
  return false;
}

const FAILURE_STATUSES = new Set([
  "stale",
  "error",
  "auth_error",
  "AUTH_FAIL",
  "stopped",
  "reconnecting",
]);

export function deskSummarizeFeedsHealth(feeds: FeedRow[]): {
  any_stale: boolean;
  any_failure: boolean;
  gated_feeds: string[];
} {
  const uwBackoff = deskUwAuthBackoffActive(feeds);
  const gated = feeds
    .filter((f) => deskFeedExcludedFromHealthGate(f, { uwAuthBackoff: uwBackoff }))
    .map((f) => f.feed);
  const active = feeds.filter((f) => !deskFeedExcludedFromHealthGate(f, { uwAuthBackoff: uwBackoff }));
  const any_stale = active.some((f) => f.stale && f.status !== "on_demand");
  const any_failure = active.some((f) => FAILURE_STATUSES.has(f.status) || f.stale);
  return { any_stale, any_failure, gated_feeds: [...new Set(gated)] };
}
