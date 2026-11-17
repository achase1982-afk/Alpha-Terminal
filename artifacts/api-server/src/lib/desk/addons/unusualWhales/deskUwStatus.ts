import {
  buildDeskHealthFeeds,
  deskMarkFeedAuthError,
  deskMarkFeedError,
  deskMarkFeedExpiredOrUnpaid,
  deskMarkFeedNotConfigured,
  deskMarkFeedRateLimited,
  type DeskFeedId,
} from "../../deskFeedFreshness.js";
import { deskUwRecordHttpStatus } from "./deskUwPollControl.js";

const UW_SOURCE = "unusual_whales";

export function deskApplyUwHttpFeedStatus(
  feed: DeskFeedId,
  status: number,
  source = UW_SOURCE,
  retryAfterSec?: number,
): void {
  if (status > 0) deskUwRecordHttpStatus(status, retryAfterSec);
  if (status === 0) {
    deskMarkFeedError(feed, "uw_network_error", source);
    return;
  }
  if (status === 401 || status === 403) {
    deskMarkFeedAuthError(feed, `uw_http_${status}`, source);
    return;
  }
  if (status === 402) {
    deskMarkFeedExpiredOrUnpaid(feed, "uw_http_402", source);
    return;
  }
  if (status === 429) {
    deskMarkFeedRateLimited(feed, `uw_http_${status}`, source);
    return;
  }
  deskMarkFeedError(feed, `uw_http_${status}`, source);
}

/** Map UW failures to HTTP status for desk routes (never 500). */
export function deskUwRouteHttpFromStatus(uwStatus: number | undefined, error?: string): {
  httpStatus: number;
  error: string;
} {
  if (error === "not_configured" || uwStatus === 0) {
    return { httpStatus: 503, error: error ?? "not_configured" };
  }
  if (uwStatus === 401 || uwStatus === 403) {
    return { httpStatus: 503, error: `uw_auth_${uwStatus}` };
  }
  if (uwStatus === 402) {
    return { httpStatus: 503, error: "uw_expired_or_unpaid" };
  }
  if (uwStatus === 429) {
    return { httpStatus: 503, error: "uw_rate_limited" };
  }
  return { httpStatus: 503, error: error ?? "uw_unavailable" };
}

export function deskUwMarkNotConfigured(feed: DeskFeedId): void {
  deskMarkFeedNotConfigured(feed, UW_SOURCE);
}

/** Stable `error` field for UW route 503 bodies from live feed health rows. */
export function deskUwRouteErrorForFeed(
  feed: DeskFeedId,
  fallback = "snapshot_unavailable",
): string {
  const row = buildDeskHealthFeeds().find((f) => f.feed === feed);
  if (!row) return "not_configured";
  switch (row.status) {
    case "not_configured":
      return "not_configured";
    case "auth_error":
      return "auth_error";
    case "expired_or_unpaid":
      return "expired_or_unpaid";
    case "rate_limited":
      return "rate_limited";
    default:
      return fallback;
  }
}
