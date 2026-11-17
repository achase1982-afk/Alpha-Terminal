import { deskFeedStaleThresholdMs, deskIsFeedStale, type DeskFeedId } from "./deskFeedFreshness.js";

export type DeskEnvelope<T> = T & {
  source: string;
  as_of: string;
  stale: boolean;
};

export function deskEnvelope<T extends Record<string, unknown>>(
  payload: T,
  source: string,
  asOfMs: number,
  feed?: DeskFeedId,
): DeskEnvelope<T> {
  const stale = feed ? deskIsFeedStale(feed, asOfMs) : false;
  return {
    ...payload,
    source,
    as_of: new Date(asOfMs).toISOString(),
    stale,
  };
}

export function deskStaleForFeed(feed: DeskFeedId, lastMs: number | null): boolean {
  if (lastMs == null) return true;
  return deskIsFeedStale(feed, lastMs);
}

export { deskFeedStaleThresholdMs };