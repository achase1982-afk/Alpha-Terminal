import { getQuoteBySymbol, type LiveQuote } from "../schwabStreamer.js";
import { augmentPolygonColdTickerForChat } from "../chatPolygonColdActivity.js";
import { logger } from "../logger.js";

const POLYGON_API = "https://api.polygon.io";

const packLog = {
  info: (obj: unknown, msg?: string) => logger.info(obj, msg),
  warn: (obj: unknown, msg?: string) => logger.warn(obj, msg),
};

function formatSchwabQuote(sym: string, q: LiveQuote): Record<string, unknown> {
  return {
    symbol: sym,
    source: "schwab_streamer_cache",
    last: q.last ?? null,
    bid: q.bid ?? null,
    ask: q.ask ?? null,
    changePct: q.changePct ?? null,
    volume: q.volume ?? null,
    high: q.high ?? null,
    low: q.low ?? null,
    prevClose: q.close ?? null,
    quoteSource: q.quoteSource ?? null,
  };
}

async function polygonLastTrade(sym: string): Promise<Record<string, unknown> | null> {
  const apiKey = (process.env.POLYGON_API_KEY ?? "").trim();
  if (!apiKey) return null;
  const to = new Date();
  const from = new Date(to.getTime() - 3 * 86_400_000);
  const fromYmd = from.toISOString().slice(0, 10);
  const toYmd = to.toISOString().slice(0, 10);
  const url =
    `${POLYGON_API}/v2/aggs/ticker/${encodeURIComponent(sym)}/range/1/day/${fromYmd}/${toYmd}` +
    `?adjusted=true&sort=desc&limit=1&apiKey=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { results?: Array<{ c?: number; v?: number }> };
    const bar = body.results?.[0];
    if (!bar || bar.c == null) return null;
    return {
      symbol: sym,
      source: "polygon_aggs",
      last: bar.c,
      volume: bar.v ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Schwab streamer cache first, Polygon aggs fallback, then cold Polygon snapshot supplement
 * (same cold-path helper as get_flow).
 */
export async function fetchQuoteForChat(
  symbol: string,
  lastUserMessage = "equity quote",
): Promise<Record<string, unknown>> {
  const sym = symbol.trim().toUpperCase();
  let base: Record<string, unknown>;

  const cached = getQuoteBySymbol(sym);
  if (cached && (cached.last != null || cached.bid != null)) {
    base = formatSchwabQuote(sym, cached);
  } else {
    const poly = await polygonLastTrade(sym);
    if (poly) {
      base = poly;
    } else {
      base = {
        symbol: sym,
        source: "none",
        error:
          "No live quote in Schwab streamer cache for this symbol on the API host, and Polygon aggs returned no data.",
      };
    }
  }

  const cold = await augmentPolygonColdTickerForChat({
    symbol: sym,
    lastUserMessage,
    highlightsBefore: null,
    packLog,
  });

  return {
    ...base,
    polygonColdSnapshot: cold.section,
    polygonColdTierBCaptureAttempted: cold.tierBCaptureAttempted,
  };
}
