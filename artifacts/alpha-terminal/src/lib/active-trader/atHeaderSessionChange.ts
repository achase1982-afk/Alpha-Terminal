import type { QuoteData } from "@/hooks/useQuote";
import {
  isOvernightQuotePlaceholder,
  resolveSessionChangeDisplay,
  type SessionChangeDisplay,
} from "@/lib/atQuoteSessionChange";

const STREAM_FLAT_EPS = 1e-6;

function isStreamFlatStub(quote: QuoteData | null): boolean {
  if (!quote) return false;
  if (quote.change !== 0 || quote.changePct !== 0) return false;
  return !isOvernightQuotePlaceholder(quote);
}

function restSessionChange(
  rest: { change?: number | null; changePct?: number | null; last?: number | null } | null | undefined,
): SessionChangeDisplay {
  if (!rest) return { change: null, changePct: null };
  if (rest.change == null || rest.changePct == null) return { change: null, changePct: null };
  if (!Number.isFinite(rest.change) || !Number.isFinite(rest.changePct)) return { change: null, changePct: null };
  if (Math.abs(rest.change) < STREAM_FLAT_EPS && Math.abs(rest.changePct) < STREAM_FLAT_EPS) {
    return { change: null, changePct: null };
  }
  return { change: rest.change, changePct: rest.changePct };
}

function priorCloseVsSpot(
  quote: QuoteData | null,
  rest: { close?: number | null; last?: number | null } | null | undefined,
  spot: number | null,
): SessionChangeDisplay {
  const close = quote?.close ?? (rest && "close" in rest ? (rest.close as number | null) : null);
  const last =
    spot ??
    quote?.regularLast ??
    quote?.last ??
    (rest && "last" in rest ? (rest.last as number | null) : null) ??
    null;
  if (close == null || last == null || !Number.isFinite(close) || !Number.isFinite(last) || close === 0) {
    return { change: null, changePct: null };
  }
  if (Math.abs(last - close) < 0.02) return { change: null, changePct: null };
  const change = last - close;
  return { change, changePct: (change / close) * 100 };
}

/** DAY row: prior regular close vs last; never trust stream 0.00% pre-market stubs. */
export function resolveAtHeaderSessionChange(
  quote: QuoteData | null,
  restQuote: { close?: number | null; change?: number | null; changePct?: number | null; last?: number | null } | null | undefined,
  spot: number | null,
): SessionChangeDisplay {
  const fromClose = priorCloseVsSpot(quote, restQuote, spot);
  if (fromClose.change != null && fromClose.changePct != null) return fromClose;

  const fromRest = restSessionChange(restQuote);
  if (fromRest.change != null && fromRest.changePct != null) return fromRest;

  if (isStreamFlatStub(quote)) return { change: null, changePct: null };

  return resolveSessionChangeDisplay(quote, restQuote);
}