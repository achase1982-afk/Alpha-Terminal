import {
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
  if (status === 401 || status === 402 || status === 403 || status === 429) {
    deskUwRecordHttpStatus(status, retryAfterSec);
  }
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