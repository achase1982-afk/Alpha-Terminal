/**
 * Parse Polygon /v3/quotes results and find NBBO at or before a trade time.
 * No persisted options quote table in this schema — call Polygon as needed.
 */
import { fetchPolygonPaged } from "./polygonPagedFetch.js";

const POLYGON_API = "https://api.polygon.io";
const QUOTE_PAGE_LIMIT = 50_000;
/** Reclassification: look back 60s and forward 5s from the print (nanoseconds in URL). */
export const RECLASSIFY_QUOTE_PAD_BEFORE_MS = 60_000;
export const RECLASSIFY_QUOTE_PAD_AFTER_MS = 5_000;

function nsToMs(ns: bigint): number {
  return Number(ns / 1_000_000n);
}

export interface QuotePoint {
  tsMs: number;
  bid: number;
  ask: number;
}

export function parseQuotes(results: unknown[]): QuotePoint[] {
  const out: QuotePoint[] = [];
  for (const raw of results) {
    const row = raw as Record<string, unknown>;
    const sip = BigInt(String(row["sip_timestamp"] ?? 0));
    if (sip <= 0n) continue;
    const bid = Number(row["bid_price"] ?? row["bp"] ?? 0);
    const ask = Number(row["ask_price"] ?? row["ap"] ?? 0);
    if (bid <= 0 || ask <= 0 || ask < bid) continue;
    out.push({ tsMs: nsToMs(sip), bid, ask });
  }
  out.sort((a, b) => a.tsMs - b.tsMs);
  return out;
}

export function nbboAtOrBefore(quotes: QuotePoint[], tsMs: number): { bid: number; ask: number } | null {
  let lo = 0;
  let hi = quotes.length - 1;
  let best: QuotePoint | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const q = quotes[mid]!;
    if (q.tsMs <= tsMs) {
      best = q;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best ? { bid: best.bid, ask: best.ask } : null;
}

/**
 * Fetch quotes for a single trade timestamp (narrow window). Reuses the same
 * /v3/quotes + paginated fetch pattern as tape backfill, without session RTH bounds.
 */
export async function fetchQuotesAroundTrade(
  occ: string,
  apiKey: string,
  tradeTsMs: number,
  deadlineMs: number,
): Promise<{
  quotes: QuotePoint[];
  truncated: boolean;
  sawPolygonHttpError: boolean;
}> {
  const gteNs = BigInt(Math.max(0, tradeTsMs - RECLASSIFY_QUOTE_PAD_BEFORE_MS)) * 1_000_000n;
  const lteNs = BigInt(tradeTsMs + RECLASSIFY_QUOTE_PAD_AFTER_MS) * 1_000_000n;
  const base = `${POLYGON_API}/v3/quotes/${encodeURIComponent(occ)}?timestamp.gte=${gteNs}&timestamp.lte=${lteNs}&order=asc&limit=${QUOTE_PAGE_LIMIT}`;
  const { rows, truncated, sawPolygonHttpError } = await fetchPolygonPaged(base, apiKey, deadlineMs);
  const parsed = parseQuotes(rows);
  const dedup: QuotePoint[] = [];
  for (const q of parsed) {
    const prev = dedup[dedup.length - 1];
    if (prev && prev.tsMs === q.tsMs && prev.bid === q.bid && prev.ask === q.ask) continue;
    dedup.push(q);
  }
  return { quotes: dedup, truncated, sawPolygonHttpError };
}
