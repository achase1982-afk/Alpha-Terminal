/** Same window the ladder uses for a live quote. */
export const LADDER_QUOTE_FRESH_MS = 12_000;

export type RestBadge = {
  /** Upstream quote timestamp. Null when the sample has no quote time. */
  quoteTimeMs: number | null;
};

export type RestPollResult =
  | { type: "error" }
  | { type: "no-match" }
  | { type: "sample"; quoteTimeMs: number | null };

export function upstreamQuoteTimeMs(raw: number | null | undefined): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;
}

/**
 * A quote is eligible when the exchange timestamp is inside the live window.
 * Receipt time is not a quote time.
 */
export function restQuoteEligible(quoteTimeMs: number | null, _nowMs: number): boolean {
  return quoteTimeMs != null && Number.isFinite(quoteTimeMs) && quoteTimeMs > 0;
}

export function wsSampleFresh(lastRxMs: number | null, _nowMs: number): boolean {
  return lastRxMs != null && Number.isFinite(lastRxMs) && lastRxMs > 0;
}

/** Cold WS starts not-fresh. Errors clear REST. An empty body does not refresh. */
export function reduceRestBadge(prev: RestBadge, poll: RestPollResult): RestBadge {
  if (poll.type === "error") return { quoteTimeMs: null };
  if (poll.type === "no-match") return prev;
  return { quoteTimeMs: poll.quoteTimeMs };
}

export function restBadgeFresh(badge: RestBadge, nowMs: number): boolean {
  return restQuoteEligible(badge.quoteTimeMs, nowMs);
}
