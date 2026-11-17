import { getStocknewsKey } from "./deskStocknews.js";

type FeedRow = { feed: string; status: string; stale: boolean };

/** Feeds intentionally left unconfigured must not affect aggregate desk health. */
export function deskFeedIntentionallyUnconfigured(feed: string): boolean {
  if (feed === "stocknews") return !getStocknewsKey();
  return false;
}

export function deskFeedExcludedFromHealthGate(row: FeedRow): boolean {
  return row.feed === "stocknews" && row.status === "not_configured";
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
  const gated = feeds.filter(deskFeedExcludedFromHealthGate).map((f) => f.feed);
  const active = feeds.filter((f) => !deskFeedExcludedFromHealthGate(f));
  const any_stale = active.some((f) => f.stale);
  const any_failure = active.some((f) => FAILURE_STATUSES.has(f.status) || f.stale);
  return { any_stale, any_failure, gated_feeds: [...new Set(gated)] };
}