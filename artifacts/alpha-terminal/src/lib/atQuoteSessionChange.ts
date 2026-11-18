import type { QuoteData } from "@/hooks/useQuote";

type QuoteNumFields = {
  change?: number | null;
  changePct?: number | null;
  high?: number | null;
  low?: number | null;
};

/** Schwab/stream overnight reset: zeros on change and session range. */
export function isOvernightQuotePlaceholder(q: QuoteNumFields): boolean {
  return q.change === 0 && q.high === 0 && q.low === 0;
}

export type SessionChangeDisplay = {
  change: number | null;
  changePct: number | null;
};

/**
 * Header / glance session change vs prior close — never surface fake $0.00 (0.00%) overnight.
 */
export function resolveSessionChangeDisplay(
  quote: QuoteData | null,
  rest?: QuoteNumFields | null,
): SessionChangeDisplay {
  if (!quote) return { change: null, changePct: null };

  if (!isOvernightQuotePlaceholder(quote)) {
    return { change: quote.change, changePct: quote.changePct };
  }

  if (
    rest &&
    rest.change != null &&
    !isOvernightQuotePlaceholder({
      change: rest.change,
      changePct: rest.changePct ?? null,
      high: rest.high ?? null,
      low: rest.low ?? null,
    })
  ) {
    return { change: rest.change ?? null, changePct: rest.changePct ?? null };
  }

  const anchor = quote.close;
  const settled = quote.regularLast ?? quote.last;
  if (
    anchor != null &&
    settled != null &&
    Number.isFinite(anchor) &&
    Number.isFinite(settled) &&
    anchor !== 0 &&
    settled !== anchor
  ) {
    const change = settled - anchor;
    return { change, changePct: (change / anchor) * 100 };
  }

  return { change: null, changePct: null };
}

/** Glance "from open" row — omit zero when feed is an overnight placeholder. */
export function resolveGlanceFromOpenChange(
  quote: QuoteData | null,
  spotShown: number | null,
  sessionOpen: number | null | undefined,
  rest?: QuoteNumFields | null,
): number | null {
  const session = resolveSessionChangeDisplay(quote, rest);
  if (session.change != null && Number.isFinite(session.change)) {
    if (session.change !== 0 || (quote != null && !isOvernightQuotePlaceholder(quote))) return session.change;
  }

  const open = sessionOpen ?? quote?.close ?? null;
  if (spotShown != null && open != null && Number.isFinite(open) && spotShown !== open) {
    return spotShown - open;
  }
  return null;
}