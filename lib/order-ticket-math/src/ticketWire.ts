import { midpointFromBidAsk } from "./optionQuotes.js";
import { formatLimitPriceDisplay, parseCanonicalLimit, type LimitTickContext } from "./optionTickRound.js";
import { computeOrderEconomics, type OrderEconomicsInput } from "./orderEconomics.js";

/** Canonical limit used on the ticket UI, review screen, and Schwab payload. */
export function resolveSubmittedLimit(
  ctx: LimitTickContext,
  limitPrice: string | number | null | undefined,
  fallback?: number | null,
): number | null {
  return parseCanonicalLimit(limitPrice, ctx, fallback ?? null);
}

export function displaySubmittedLimit(ctx: LimitTickContext, limit: number | null): string {
  if (limit == null) return "";
  return formatLimitPriceDisplay(limit, ctx);
}

export function stockMidLimit(bid: number | null | undefined, ask: number | null | undefined): string | null {
  const mid = midpointFromBidAsk(bid, ask);
  if (mid == null) return null;
  return String(mid);
}

export function optionMidLimit(
  ctx: LimitTickContext,
  bid: number | null | undefined,
  ask: number | null | undefined,
): string | null {
  const mid = midpointFromBidAsk(bid, ask);
  if (mid == null) return null;
  const rounded = parseCanonicalLimit(mid, ctx);
  if (rounded == null) return null;
  return displaySubmittedLimit(ctx, rounded);
}

export function schwabPriceFromTicket(
  ctx: LimitTickContext,
  limitPrice: string,
  fallback?: number | null,
): number {
  return resolveSubmittedLimit(ctx, limitPrice, fallback) ?? 0;
}

/** Economics for ticket + review — single entry point. */
export function ticketAndReviewEconomics(input: OrderEconomicsInput) {
  return computeOrderEconomics(input);
}