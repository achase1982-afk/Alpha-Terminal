import { deskIsFeedStale, type DeskFeedId } from "./deskFeedFreshness.js";

function pickNum(row: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

/** Quote event time for staleness — not HTTP fetch time. */
export function deskQuoteRowEventMs(row: Record<string, unknown>): number | null {
  const qt = pickNum(row, ["quote_ts", "quoteTime", "t"]);
  if (qt != null && qt > 1_000_000_000_000) return qt;
  if (qt != null && qt > 0) return qt < 1e12 ? qt * 1000 : qt;
  const tt = pickNum(row, ["trade_ts", "tradeTime"]);
  if (tt != null && tt > 0) return tt < 1e12 ? tt * 1000 : tt;
  const iso = row["t"];
  if (typeof iso === "string") {
    const p = Date.parse(iso);
    if (Number.isFinite(p)) return p;
  }
  return null;
}

export function deskTwoSidedQuoteValid(bid: number | null, ask: number | null): boolean {
  return bid != null && ask != null && bid > 0 && ask > 0 && bid <= ask;
}

export function deskQuoteRowStale(eventMs: number | null, feed: DeskFeedId, now = Date.now()): boolean {
  if (eventMs == null) return true;
  return deskIsFeedStale(feed, eventMs, now);
}

export function annotateDeskQuoteRow(
  row: Record<string, unknown>,
  feed: DeskFeedId,
  now = Date.now(),
): Record<string, unknown> {
  const bid = pickNum(row, ["bid", "bidPrice", "bp"]);
  const ask = pickNum(row, ["ask", "askPrice", "ap"]);
  const eventMs = deskQuoteRowEventMs(row);
  const quote_invalid = !deskTwoSidedQuoteValid(bid, ask);
  const stale = deskQuoteRowStale(eventMs, feed, now);
  return {
    ...row,
    quote_event_ms: eventMs,
    stale,
    quote_invalid,
  };
}

export function annotateDeskQuoteRows(
  rows: Record<string, unknown>[],
  feed: DeskFeedId,
  now = Date.now(),
): Record<string, unknown>[] {
  return rows.map((r) => annotateDeskQuoteRow(r, feed, now));
}

export function deskQuotesEnvelopeAsOfMs(rows: Record<string, unknown>[], fallback = Date.now()): number {
  let max = 0;
  for (const r of rows) {
    const t = deskQuoteRowEventMs(r);
    if (t != null) max = Math.max(max, t);
  }
  return max > 0 ? max : fallback;
}