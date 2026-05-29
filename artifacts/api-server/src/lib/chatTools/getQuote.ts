import type { MarketSessionLabel } from "../getMarketContext.js";
import { getMarketContext } from "../getMarketContext.js";
import {
  displayLastForSession,
  resolveLiveQuoteFromStreamer,
} from "../chatLiveQuote.js";
import { fetchSchwabRestQuote } from "../schwabRestQuote.js";
import { augmentPolygonColdTickerForChat } from "../chatPolygonColdActivity.js";
import { logger } from "../logger.js";
import { normalizeQuote, type NormalizedQuote } from "../quote-normalizer.js";
import { rawQuoteFromLiveQuote, rawQuoteFromSchwabRest } from "../quoteRawBridge.js";
import type { LiveQuote } from "../schwabStreamer.js";

const POLYGON_API = "https://api.polygon.io";

const packLog = {
  info: (obj: unknown, msg?: string) => logger.info(obj, msg),
  warn: (obj: unknown, msg?: string) => logger.warn(obj, msg),
};

const QUOTE_CITATION_RULE =
  "When citing a quote, use ONLY the fields from the normalized quote object and quote its `summary` verbatim. Never compute a price change yourself, and never pair a price from one session with a change from another (e.g. an after-hours price with the regular-session change).";

export { QUOTE_CITATION_RULE };

function attachNormalizedQuote(
  sym: string,
  base: Record<string, unknown>,
  raw: Parameters<typeof normalizeQuote>[0] | null,
  now: Date,
): Record<string, unknown> {
  if (!raw) return base;
  const normalizedQuote: NormalizedQuote = normalizeQuote(raw, now);
  const displayLast = normalizedQuote.lastPrice;
  return {
    ...base,
    symbol: sym,
    displayLast,
    last: displayLast,
    latestPrint: displayLast,
    regularSessionLast: normalizedQuote.regularClose,
    prevClose: normalizedQuote.priorClose,
    normalizedQuote,
    quoteCitationRule: QUOTE_CITATION_RULE,
  };
}

export function formatSchwabQuote(
  sym: string,
  q: LiveQuote,
  session: MarketSessionLabel = "OPEN",
  now: Date = new Date(),
): Record<string, unknown> {
  const displayLast = displayLastForSession(q, session);
  const regularSessionLast = q.regularLast ?? null;
  const latestPrint = q.last ?? q.extendedLast ?? null;
  const base: Record<string, unknown> = {
    symbol: sym,
    source: "schwab_live_tape",
    displayLast,
    regularSessionLast,
    latestPrint,
    bid: q.bid ?? null,
    ask: q.ask ?? null,
    volume: q.volume ?? null,
    high: q.high ?? null,
    low: q.low ?? null,
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
  return attachNormalizedQuote(sym, base, rawQuoteFromLiveQuote(sym, q, session), now);
}

function formatRestQuote(
  sym: string,
  rest: NonNullable<Awaited<ReturnType<typeof fetchSchwabRestQuote>>>,
  session: MarketSessionLabel,
  now: Date,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    symbol: sym,
    source: "schwab_rest",
    displayLast: rest.last,
    regularSessionLast: rest.regularMarketLast,
    latestPrint: rest.last,
    bid: rest.bid,
    ask: rest.ask,
    volume: rest.volume,
    high: rest.high,
    low: rest.low,
    prevClose: rest.prevClose,
    quoteAgeMs: 0,
    marketSession: session,
    tapeNote: "schwab_rest_quote",
  };
  return attachNormalizedQuote(sym, base, rawQuoteFromSchwabRest(rest, session), now);
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
    `?adjusted=true&sort=desc&limit=2&apiKey=${encodeURIComponent(apiKey)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { results?: Array<{ c?: number; v?: number; t?: number }> };
    const bars = body.results ?? [];
    if (bars.length === 0 || bars[0]?.c == null) return null;
    const todayBar = bars[0];
    const priorBar = bars[1];
    const priorClose = priorBar?.c;
    const todayRegularClose = todayBar.c ?? null;
    const lastPrice = todayBar.c;
    if (priorClose == null || lastPrice == null) return null;
    const raw = {
      symbol: sym,
      priorClose,
      todayRegularClose: bars.length >= 2 ? todayRegularClose : null,
      lastPrice,
      lastTradeTime: todayBar.t
        ? new Date(todayBar.t).toISOString()
        : new Date().toISOString(),
    };
    const base: Record<string, unknown> = {
      symbol: sym,
      source: "polygon_aggs_prior_session",
      displayLast: lastPrice,
      latestPrint: lastPrice,
      volume: todayBar.v ?? null,
      tapeNote: "polygon_eod_fallback_not_live",
    };
    return attachNormalizedQuote(sym, base, raw, new Date());
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
  const now = options.now ?? new Date();
  const session = getMarketContext(now, options.clientTimeZone ?? undefined).session;
  const token = options.marketAccessToken?.trim() ?? null;

  let base: Record<string, unknown>;

  const live = await resolveLiveQuoteFromStreamer(sym, token);
  if (live && (live.last != null || live.bid != null)) {
    base = formatSchwabQuote(sym, live, session, now);
  } else if (token) {
    const rest = await fetchSchwabRestQuote(sym, token);
    if (rest?.last != null) {
      base = formatRestQuote(sym, rest, session, now);
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
