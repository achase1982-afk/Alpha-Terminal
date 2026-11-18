import type { QuoteData } from "@/hooks/useQuote";
import { resolveSessionChangeDisplay, type SessionChangeDisplay } from "@/lib/atQuoteSessionChange";

/** DAY row: prior regular close vs last, with REST/stream fallbacks. */
export function resolveAtHeaderSessionChange(
  quote: QuoteData | null,
  restQuote: { close?: number | null; change?: number | null; changePct?: number | null } | null | undefined,
  spot: number | null,
): SessionChangeDisplay {
  const base = resolveSessionChangeDisplay(quote, restQuote);
  if (base.change != null && base.changePct != null) return base;

  const close =
    quote?.close ??
    (restQuote && "close" in restQuote ? (restQuote.close as number | null) : null) ??
    null;
  const last =
    spot ??
    quote?.regularLast ??
    quote?.last ??
    (restQuote && "last" in restQuote ? (restQuote as { last?: number }).last : null) ??
    null;

  if (close != null && last != null && Number.isFinite(close) && Number.isFinite(last) && close !== 0) {
    const change = last - close;
    return { change, changePct: (change / close) * 100 };
  }

  return base;
}