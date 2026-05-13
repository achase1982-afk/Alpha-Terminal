/**
 * Assembles a bounded text context bundle for `/api/ai/chat`: Schwab quote cache,
 * Polygon-backed options flow highlights + session tape, optional strike-focused
 * prints (parsed from the user's question), stored IVR, next earnings, FMP headlines.
 */
import { and, db, desc, eq, optionsFlowRawTradesTable } from "@workspace/db";
import { getPolygonFlowHighlights, type PolygonFlowHighlights } from "./polygonFlowHighlights.js";
import { getQuoteBySymbol, type LiveQuote } from "./schwabStreamer.js";
import { getStoredIVR } from "./ivNormalize.js";
import { getNextEarningsDate } from "./earningsService.js";
import { logger } from "./logger.js";

const FMP_NEWS_LIMIT = 12;
const FOCUSED_PRINTS_PER_STRIKE = 25;

/** Pull likely equity option strike(s) the user named (e.g. "800 call", "800c"). */
export function extractOptionStrikeHints(text: string): number[] {
  const out = new Set<number>();
  const lower = text.toLowerCase();
  const patterns = [
    /\b(\d{2,4}(?:\.\d+)?)\s*(?:call|calls)\b/gi,
    /\b(\d{2,4}(?:\.\d+)?)c\b/gi,
    /\$(\d{2,4}(?:\.\d+)?)\s*(?:call|calls)\b/gi,
    /\b(\d{2,4}(?:\.\d+)?)\s*(?:put|puts)\b/gi,
    /\b(\d{2,4}(?:\.\d+)?)p\b/gi,
    /\$(\d{2,4}(?:\.\d+)?)\s*(?:put|puts)\b/gi,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lower)) !== null) {
      const v = Number.parseFloat(m[1] ?? "");
      if (Number.isFinite(v) && v >= 1 && v <= 100_000) out.add(v);
    }
  }
  return [...out];
}

function formatLiveQuote(sym: string, q: LiveQuote): string {
  const parts = [
    `symbol=${sym}`,
    `last=${q.last ?? "n/a"}`,
    `bid=${q.bid ?? "n/a"}`,
    `ask=${q.ask ?? "n/a"}`,
    `changePct=${q.changePct ?? "n/a"}`,
    `volume=${q.volume ?? "n/a"}`,
    `high=${q.high ?? "n/a"}`,
    `low=${q.low ?? "n/a"}`,
    `quoteSource=${q.quoteSource ?? "unknown"}`,
  ];
  return parts.join(" ");
}

async function fetchFmpHeadlines(symbol: string): Promise<string[]> {
  const key = (process.env.FMP_API_KEY ?? "").trim();
  if (!key) return [];
  const sym = symbol.toUpperCase().trim();
  try {
    const url =
      `https://financialmodelingprep.com/api/v3/stock_news?tickers=${encodeURIComponent(sym)}` +
      `&limit=${FMP_NEWS_LIMIT}&apikey=${encodeURIComponent(key)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const raw = (await res.json()) as unknown;
    if (!Array.isArray(raw)) return [];
    const lines: string[] = [];
    for (const row of raw) {
      if (!row || typeof row !== "object") continue;
      const o = row as Record<string, unknown>;
      const title = typeof o.title === "string" ? o.title : "";
      const site = typeof o.site === "string" ? o.site : "";
      const published = typeof o.publishedDate === "string" ? o.publishedDate : "";
      if (title) lines.push(`- ${published} ${title}${site ? ` (${site})` : ""}`);
    }
    return lines;
  } catch (err) {
    logger.warn({ err, sym }, "aiChatContextPack: FMP stock_news fetch failed");
    return [];
  }
}

async function fetchFocusedStrikePrints(
  underlying: string,
  sessionDate: string,
  strike: number,
): Promise<string[]> {
  const sym = underlying.toUpperCase();
  try {
    const rows = await db
      .select({
        ts: optionsFlowRawTradesTable.timestamp,
        strike: optionsFlowRawTradesTable.strike,
        expiration: optionsFlowRawTradesTable.expiration,
        optionType: optionsFlowRawTradesTable.optionType,
        tradePrice: optionsFlowRawTradesTable.tradePrice,
        size: optionsFlowRawTradesTable.size,
        notional: optionsFlowRawTradesTable.notional,
        side: optionsFlowRawTradesTable.side,
        aggressorConfidence: optionsFlowRawTradesTable.aggressorConfidence,
        isBlock: optionsFlowRawTradesTable.isBlock,
        isSweep: optionsFlowRawTradesTable.isSweep,
        exchangeId: optionsFlowRawTradesTable.exchangeId,
      })
      .from(optionsFlowRawTradesTable)
      .where(
        and(
          eq(optionsFlowRawTradesTable.underlyingSymbol, sym),
          eq(optionsFlowRawTradesTable.date, sessionDate),
          eq(optionsFlowRawTradesTable.strike, strike),
        ),
      )
      .orderBy(desc(optionsFlowRawTradesTable.notional))
      .limit(FOCUSED_PRINTS_PER_STRIKE);

    return rows.map((r) => {
      const expRaw = r.expiration as unknown;
      const exp = expRaw instanceof Date ? expRaw.toISOString().slice(0, 10) : String(expRaw ?? "");
      const tsRaw = r.ts as unknown;
      const ts = tsRaw instanceof Date ? tsRaw.toISOString() : String(tsRaw ?? "");
      return (
        `${ts} ${r.optionType} ${r.strike} exp=${exp} px=${r.tradePrice} sz=${r.size} ` +
        `notional=${r.notional ?? "?"} side=${r.side ?? "?"} conf=${r.aggressorConfidence ?? "?"} ` +
        `block=${Boolean(r.isBlock)} sweep=${Boolean(r.isSweep)} exch=${r.exchangeId ?? "?"}`
      );
    });
  } catch (err) {
    logger.warn({ err, sym, sessionDate, strike }, "aiChatContextPack: focused strike query failed");
    return [];
  }
}

function trimHighlightsForTokens(h: PolygonFlowHighlights): Record<string, unknown> {
  const st = h.sessionTape;
  const exec = st?.execPerStrike ?? [];
  const execSorted = [...exec].sort((a, b) => (b.sweepVolume + b.blockVolume + b.regularVolume)
    - (a.sweepVolume + a.blockVolume + a.regularVolume));
  return {
    asOfDate: h.asOfDate,
    totalCallVolume: h.totalCallVolume,
    totalPutVolume: h.totalPutVolume,
    putCallVolumeRatio: h.putCallVolumeRatio,
    unusualStrikeCount: h.unusualStrikeCount,
    unusualSkew: h.unusualSkew,
    topByVolume: h.topByVolume?.slice(0, 12) ?? [],
    topByVolOiRatio: h.topByVolOiRatio?.slice(0, 12) ?? [],
    largestPrint: h.largestPrint,
    sessionTapeDate: h.sessionTapeDate,
    sessionTapeLookupCounts: h.sessionTapeLookupCounts,
    sessionTape: st
      ? {
          sessionDate: st.sessionDate,
          tapeKind: st.tapeKind,
          sessionAggregateSource: st.sessionAggregateSource,
          tapeBackfillReason: st.tapeBackfillReason,
          aggressorSessionTotals: st.aggressorSessionTotals,
          topPrints: st.topPrints,
          aggressorByStrike: (st.aggressorByStrike ?? []).slice(0, 40),
          execPerStrike: execSorted.slice(0, 35),
        }
      : null,
  };
}

export interface AiChatContextPackInput {
  symbol: string;
  /** Last user message — used to pull extra tape rows for named strikes. */
  lastUserMessage?: string;
}

/**
 * Returns a large markdown-ish text block appended under Schwab quote context.
 * Safe to concatenate into the system prompt.
 */
export async function buildAiChatContextPack(input: AiChatContextPackInput): Promise<string> {
  const sym = input.symbol.toUpperCase().trim();
  if (!sym) return "(No symbol — terminal context pack skipped.)";

  const sections: string[] = [];

  const cached = getQuoteBySymbol(sym);
  if (cached) {
    sections.push("### Server Schwab / streamer quote cache\n" + formatLiveQuote(sym, cached));
  } else {
    sections.push("### Server Schwab / streamer quote cache\n(no cached equity quote for this symbol on the API server)");
  }

  const [ivr, highlights, earnings, fmpLines] = await Promise.all([
    getStoredIVR(sym),
    getPolygonFlowHighlights(sym),
    getNextEarningsDate(sym).catch(() => null),
    fetchFmpHeadlines(sym),
  ]);

  if (ivr) {
    sections.push(`### Stored IV rank (equity_daily)\nIVR=${ivr.ivr} asOf=${ivr.asOfDate} source=${ivr.source ?? "unknown"}`);
  } else {
    sections.push("### Stored IV rank\n(not available for this symbol)");
  }

  if (earnings?.earningsDate) {
    sections.push(
      `### Next earnings (service)\n${earnings.earningsDate}${earnings.confirmed ? " (confirmed)" : " (unconfirmed)"}`,
    );
  }

  if (highlights) {
    const trimmed = trimHighlightsForTokens(highlights);
    sections.push(
      "### Polygon / DB options flow highlights (JSON)\n```json\n"
        + JSON.stringify(trimmed, null, 2)
        + "\n```",
    );

    const sessionDate = highlights.sessionTapeDate ?? highlights.asOfDate;
    const hints = extractOptionStrikeHints(input.lastUserMessage ?? "");
    for (const strike of hints) {
      const lines = await fetchFocusedStrikePrints(sym, sessionDate, strike);
      if (lines.length > 0) {
        sections.push(
          `### Focused classified prints (strike ${strike}, session ${sessionDate})\n`
            + lines.join("\n"),
        );
      }
    }
  } else {
    sections.push(
      "### Polygon / DB options flow highlights\n"
        + "(No fresh per-strike flow snapshot in DB for this symbol, or data older than the staleness window.)",
    );
  }

  if (fmpLines.length > 0) {
    sections.push("### Recent headlines (FMP stock_news)\n" + fmpLines.join("\n"));
  } else {
    sections.push("### Recent headlines (FMP)\n(none returned or FMP_API_KEY not configured)");
  }

  return sections.join("\n\n");
}
