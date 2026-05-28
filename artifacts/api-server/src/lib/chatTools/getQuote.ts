import type { MarketSessionLabel } from "../getMarketContext.js";
import { getMarketContext } from "../getMarketContext.js";
import {
  displayLastForSession,
  resolveLiveQuoteFromStreamer,
} from "../chatLiveQuote.js";
import { fetchSchwabRestQuote } from "../schwabRestQuote.js";
import { augmentPolygonColdTickerForChat } from "../chatPolygonColdActivity.js";
import { logger } from "../logger.js";
import type { LiveQuote } from "../schwabStreamer.js";

const POLYGON_API = "https://api.polygon.io";

const packLog = {
  info: (obj: unknown, msg?: string) => logger.info(obj, msg),
  warn: (obj: unknown, msg?: string) => logger.warn(obj, msg),
};

export function formatSchwabQuote(
  sym: string,
  q: LiveQuote,
  session: MarketSessionLabel = "OPEN",
): Record<string, unknown> {
  const displayLast = displayLastForSession(q, session);
  const regularSessionLast = q.regularLast ?? null;
  const latestPrint = q.last ?? q.extendedLast ?? null;
  return {
    symbol: sym,
    source: "schwab_live_tape",
    last: displayLast,
    displayLast,
    regularSessionLast,
    latestPrint,
    bid: q.bid ?? null,
    ask: q.ask ?? null,
    change: q.change ?? null,
    changePct: q.changePct ?? null,
    volume: q.volume ?? null,
    high: q.high ?? null,
    low: q.low ?? null,
    prevClose: q.close ?? null,
    quoteSource: q.quoteSource ?? null,
    quoteAgeMs: Math.max(0, Date.now() - (q.ts || 0)),
    marketSession: session,
    tapeNote:
      session === "OPEN"
        ? "regular_session_print"
        : session === "PREMARKET" || session === "AFTERHOURS"
          ? "extended_hours_print"
          : "overnight_or_closed_may_be_stale",
  };
}

function formatRestQuote(
  sym: string,
  rest: Awaited<ReturnType<typeof fetchSchwabRestQuote>>,
  session: MarketSessionLabel,
): Record<string, unknown> {
  if (!rest) return { symbol: sym, source: "none", error: "no_quote" };
  return {
    symbol: sym,
    source: "schwab_rest",
    last: rest.last,
    displayLast: rest.last,
    regularSessionLast: rest.last,
    latestPrint: rest.last,
    bid: rest.bid,
    ask: rest.ask,
    change: rest.change,
    changePct: rest.changePct,
    volume: rest.volume,
    high: rest.high,
    low: rest.low,
    prevClose: rest.prevClose,
    quoteAgeMs: 0,
    marketSession: session,
    tapeNote: "schwab_rest_quote",
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
      source: "polygon_aggs_prior_session",
      last: bar.c,
      displayLast: bar.c,
      volume: bar.v ?? null,
      tapeNote: "polygon_eod_fallback_not_live",
    };
  } catch {
    return null;
  }
}

export type FetchQuoteForChatOptions = {
  marketAccessToken?: string | null;
  clientTimeZone?: string | null;
  now?: Date;
};

/**
 * Schwab live tape (subscribe-on-miss + stream cache + REST), then Polygon EOD fallback.
 */
export async function fetchQuoteForChat(
  symbol: string,
  lastUserMessage = "equity quote",
  options: FetchQuoteForChatOptions = {},
): Promise<Record<string, unknown>> {
  const sym = symbol.trim().toUpperCase();
  const session = getMarketContext(options.now ?? new Date(), options.clientTimeZone ?? undefined).session;
  const token = options.marketAccessToken?.trim() ?? null;

  let base: Record<string, unknown>;

  const live = await resolveLiveQuoteFromStreamer(sym, token);
  if (live && (live.last != null || live.bid != null)) {
    base = formatSchwabQuote(sym, live, session);
  } else if (token) {
    const rest = await fetchSchwabRestQuote(sym, token);
    if (rest?.last != null) {
      base = formatRestQuote(sym, rest, session);
    } else {
      const poly = await polygonLastTrade(sym);
      base =
        poly ??
        ({
          symbol: sym,
          source: "none",
          error: "No live quote from Schwab stream or REST, and Polygon aggs returned no data.",
        } as Record<string, unknown>);
    }
  } else {
    const poly = await polygonLastTrade(sym);
    base =
      poly ??
      ({
        symbol: sym,
        source: "none",
        error: "No live quote available (Schwab not connected on server).",
      } as Record<string, unknown>);
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
