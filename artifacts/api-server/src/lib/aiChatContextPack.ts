/**
 * Assembles a bounded text context bundle for `/api/ai/chat`: Schwab quote cache,
 * session VWAP (Schwab 1m bars) + daily RSI14, Schwab/Polygon options chain (delta-banded),
 * on-demand Polygon snapshot (cold ticker Tier A/B) + Polygon-backed options flow highlights + session tape,
 * daily Bollinger Bands (20, 2) from equity_daily closes,
 * optional strike-focused prints (parsed from the user's question), stored IVR, next earnings, FMP headlines.
 */
import {
  and,
  asc,
  db,
  desc,
  eq,
  equityDailyTable,
  optionsFlowRawTradesTable,
  schwabChartEquityBarsTable,
} from "@workspace/db";
import { augmentPolygonColdTickerForChat } from "./chatPolygonColdActivity.js";
import { getPolygonFlowHighlights, type PolygonFlowHighlights } from "./polygonFlowHighlights.js";
import { requestFlowCapture } from "./flowCaptureService.js";
import { getQuoteBySymbol, type LiveQuote } from "./schwabStreamer.js";
import { getStoredIVR } from "./ivNormalize.js";
import { getNextEarningsDate } from "./earningsService.js";
import { logger } from "./logger.js";
import { nyCalendarYmd } from "./polygonMarketCalendar.js";
import { fetchDailyBollinger20Line } from "./bollingerBandsDaily.js";
import { getOrFetchChain, type CachedChain } from "../routes/market.js";

const FMP_NEWS_LIMIT = 12;
const FOCUSED_PRINTS_PER_STRIKE = 25;
/**
 * Uppercase tokens that look like tickers but are usually English / chart jargon.
 * Must match the stopword list in the alpha-terminal `resolveChatContextSymbol` helper.
 */
export const AI_CHAT_TICKER_STOPWORDS = new Set<string>([
  "AND",
  "ARE",
  "ATH",
  "ATL",
  "ASK",
  "BID",
  "BUT",
  "BUY",
  "CAN",
  "DAY",
  "DID",
  "DOES",
  "DOWN",
  "EPS",
  "ETF",
  "FOR",
  "GET",
  "GOT",
  "HAD",
  "HAS",
  "HER",
  "HIM",
  "HIS",
  "HOW",
  "IPO",
  "ITS",
  "IV",
  "LET",
  "LOW",
  "MAY",
  "NAV",
  "NEW",
  "NOT",
  "NOW",
  "ONE",
  "OUR",
  "OUT",
  "PUT",
  "RSI",
  "SAW",
  "SAY",
  "SELL",
  "SHE",
  "THE",
  "TOO",
  "TWO",
  "USE",
  "VIX",
  "WAS",
  "WAY",
  "WHO",
  "WHY",
  "YES",
  "YET",
  "YOU",
  "YTD",
  "OPEN",
  "HIGH",
  "CLOSE",
  "FROM",
  "INTO",
  "THAN",
  "THEN",
  "THEM",
  "WITH",
  "JUST",
  "ALSO",
  "ONLY",
  "SOME",
  "SUCH",
  "VERY",
  "WHAT",
  "WHEN",
  "WHERE",
  "WHICH",
  "YOUR",
  "ABOUT",
  "AFTER",
  "AGAIN",
  "BEING",
  "COULD",
  "FIRST",
  "GOING",
  "GOOD",
  "GREAT",
  "HEDGE",
  "HERE",
  "LAST",
  "LIKE",
  "LONG",
  "MADE",
  "MAKE",
  "MANY",
  "MORE",
  "MOST",
  "MUCH",
  "NEXT",
  "OVER",
  "PART",
  "SAME",
  "SEEN",
  "SHOW",
  "STAY",
  "TAKE",
  "THAT",
  "THESE",
  "THEY",
  "THIS",
  "TIME",
  "THOSE",
  "UNDER",
  "WELL",
  "WERE",
  "WILL",
  "WORK",
  "BACK",
  "CALL",
  "CASH",
  "COME",
  "EVEN",
  "EVER",
  "FEEL",
  "FIND",
  "FORM",
  "FULL",
  "GAVE",
  "GIVE",
  "HELP",
  "HOLD",
  "KEEP",
  "KNOW",
  "LIFE",
  "LIVE",
  "LOOK",
  "MOVE",
  "NAME",
  "NEED",
  "PLAY",
  "READ",
  "REAL",
  "RUNS",
  "SAID",
  "SEEM",
  "SIDE",
  "SURE",
  "TELL",
  "TURN",
  "USED",
  "WANT",
  "WEEK",
  "YEAR",
  // Natural-language tokens that match [A-Z]{2,5} but are not tickers (e.g. "what's AMZN stock doing").
  "DOING",
  "STOCK",
  "STOCKS",
  "SHARE",
  "SHARES",
  "TODAY",
]);

const MULTI_AGENT_SYNTH_MARKER = "You are the final **synthesizer**";

/**
 * Concatenate recent **user** turns for ticker routing, flow-intent heuristics, and the context pack.
 * Follow-up messages ("pull options flow") often omit the symbol; scanning prior user lines keeps
 * `$MSFT` / `MSFT` from the thread. Drops the multi-agent synthesizer pseudo-user turn when it is
 * the latest slice entry.
 */
export function extractRoutingTextFromChatMessages(
  messages: ReadonlyArray<{ role: string; content: string }>,
  maxUserTurns = 6,
): string {
  const userTurns = messages
    .filter((m) => m.role === "user")
    .map((m) => String(m.content ?? "").trim())
    .filter(Boolean);
  let slice = userTurns.slice(-maxUserTurns);
  const last = slice[slice.length - 1] ?? "";
  if (last.includes(MULTI_AGENT_SYNTH_MARKER) && slice.length >= 2) {
    slice = slice.slice(0, -1);
  }
  return slice.join("\n");
}

/**
 * Time & sales / options-print desk phrasing ("the tape", "options tape").
 * When this matches and the user did not clearly name the TAPE equity, the **page**
 * symbol should drive flow/tape context. Use `$TAPE` to force the TAPE equity ticker.
 */
export function routingTextLooksLikeSessionTape(routingText: string): boolean {
  const t = routingText.trim().toUpperCase().replace(/\u2019/g, "'");
  if (!t) return false;
  const patterns: RegExp[] = [
    /\bTHE\s+TAPE\b/,
    /\bOPTIONS?\s+TAPE\b/,
    /\bSESSION\s+TAPE\b/,
    /\bMARKET\s+TAPE\b/,
    /\bFLOW\s+TAPE\b/,
    /\bLIVE\s+TAPE\b/,
    /\bON\s+THE\s+TAPE\b/,
    /\bFROM\s+THE\s+TAPE\b/,
    /\bREAD\s+THE\s+TAPE\b/,
    /\bWHAT(?:'S| IS)\s+THE\s+TAPE\b/,
    /\bHOW(?:'S| IS)\s+THE\s+TAPE\b/,
    /\bTAPE\s+PRINTS?\b/,
    /\bTAPE\s+ACTIVITY\b/,
  ];
  return patterns.some((re) => re.test(t));
}

/** User is likely asking about the TAPE equity ticker, not time & sales. */
export function routingTextNamesTapeEquity(routingText: string): boolean {
  const t = routingText.trim().toUpperCase().replace(/\u2019/g, "'");
  if (!t) return false;
  return (
    /\bSHARES?\s+OF\s+TAPE\b/.test(t) ||
    /\bTAPE\s+SHARES?\b/.test(t) ||
    /\bTAPE\s+STOCK\b/.test(t) ||
    /\bTAPE\s+(?:EARNINGS|GUIDANCE|REVENUE|FLOAT)\b/.test(t) ||
    /\b(?:BUY|SELL|SHORT|LONG)\s+TAPE\b/.test(t) ||
    /\bTAPE\s+(?:PRICE|CHART|IV|IVR|OPTIONS)\b/.test(t)
  );
}

/** True when the user is asking for headlines, catalysts, filings, or "why is it moving" style context. */
export function routingTextWantsNewsOrCatalyst(routingText: string): boolean {
  const t = routingText.trim().toUpperCase().replace(/\u2019/g, "'");
  if (!t) return false;
  if (
    /\b(RUMOU?R|HEADLINES?|NEWS|BREAKING|UPGRADE|DOWNGRADE|CATALYST|ANNOUNCEMENT|MERGER|ACQUISITION|TAKEOVER|CHATTER|GUIDANCE|FILING|8-K|10-Q|10-K|PRESS\s+RELEASE)\b/.test(t)
  ) {
    return true;
  }
  if (/\b(WHY|WHAT)\b.*\b(MOVE|MOVES|MOVING|PUMP|DUMP|RIP|RIPS|RIPPING|RALLY|SURGE|SPIKE)\b/.test(t)) return true;
  if (/\b(HAPPENED|HAPPENING|GOING\s+ON|DRIVING|DRIVES)\b/.test(t)) return true;
  if (/\b(EARNINGS|REVENUE)\b.*\b(BEAT|MISS|SURPRISE|PRINT)\b/.test(t)) return true;
  if (/\b(CAUSE|REASON)\b.*\b(MOVE|PRICE|STOCK|ACTION)\b/.test(t)) return true;
  return false;
}

/**
 * Pick which equity symbol should drive terminal DB tape / flow context when the
 * terminal page symbol may differ from the ticker named in the user's text.
 */
export function resolveAiChatContextSymbol(pageSymbol: string, routingText: string): string {
  const page = pageSymbol.trim().toUpperCase();
  const text = routingText.trim().toUpperCase().replace(/\u2019/g, "'");
  if (!text) return page || "";

  const dollarSyms: string[] = [];
  const reDollar = /\$([A-Z]{2,5})\b/g;
  let dm: RegExpExecArray | null;
  while ((dm = reDollar.exec(text)) !== null) {
    dollarSyms.push(dm[1]!);
  }
  if (dollarSyms.length > 0) {
    return dollarSyms[dollarSyms.length - 1]!;
  }

  if (
    page &&
    routingTextLooksLikeSessionTape(text) &&
    !routingTextNamesTapeEquity(text)
  ) {
    return page;
  }

  const bareOrdered: string[] = [];
  const reBare = /\b([A-Z]{2,5})\b/g;
  let bm: RegExpExecArray | null;
  while ((bm = reBare.exec(text)) !== null) {
    if (bm.index > 0 && text[bm.index - 1] === "$") continue;
    const w = bm[1]!;
    if (AI_CHAT_TICKER_STOPWORDS.has(w)) continue;
    bareOrdered.push(w);
  }
  if (bareOrdered.length === 0) return page || "";

  const last = bareOrdered[bareOrdered.length - 1]!;
  if (last === page && bareOrdered.length >= 2) {
    return bareOrdered[bareOrdered.length - 2]!;
  }
  return last;
}

/** Delta band for AI chat chain snapshot (absolute delta). */
const CHAT_CHAIN_DELTA_MIN = 0.08;
const CHAT_CHAIN_DELTA_MAX = 0.25;
const CHAT_CHAIN_MAX_EXPIRATIONS = 4;

export type AiChatPackLog = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

function expirationSortKey(exp: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(exp.trim());
  return m?.[1] ?? exp.trim();
}

type ChainRow = {
  expKey: string;
  strike: number;
  type: "C" | "P";
  bid?: number;
  ask?: number;
  delta?: number;
  iv?: number;
  oi?: number;
};

function deltaInChatBand(delta: number | undefined): boolean {
  if (delta == null || !Number.isFinite(delta)) return false;
  const a = Math.abs(delta);
  return a >= CHAT_CHAIN_DELTA_MIN && a <= CHAT_CHAIN_DELTA_MAX;
}

function collectChainRowsForChat(chain: CachedChain): { rows: ChainRow[]; expKeys: string[] } {
  const nyToday = nyCalendarYmd(new Date());
  const expSet = new Set<string>();
  for (const c of chain.calls) expSet.add(expirationSortKey(c.expiration));
  for (const p of chain.puts) expSet.add(expirationSortKey(p.expiration));

  const sortedFuture = [...expSet].filter((e) => e >= nyToday).sort();
  const chosen =
    sortedFuture.length > 0
      ? sortedFuture.slice(0, CHAT_CHAIN_MAX_EXPIRATIONS)
      : [...expSet].sort().slice(0, CHAT_CHAIN_MAX_EXPIRATIONS);
  const chosenSet = new Set(chosen);

  const rows: ChainRow[] = [];
  for (const c of chain.calls) {
    const expKey = expirationSortKey(c.expiration);
    if (!chosenSet.has(expKey)) continue;
    if (!deltaInChatBand(c.delta)) continue;
    rows.push({
      expKey,
      strike: c.strike,
      type: "C",
      bid: c.bid,
      ask: c.ask,
      delta: c.delta,
      iv: c.iv,
      oi: c.openInterest,
    });
  }
  for (const p of chain.puts) {
    const expKey = expirationSortKey(p.expiration);
    if (!chosenSet.has(expKey)) continue;
    if (!deltaInChatBand(p.delta)) continue;
    rows.push({
      expKey,
      strike: p.strike,
      type: "P",
      bid: p.bid,
      ask: p.ask,
      delta: p.delta,
      iv: p.iv,
      oi: p.openInterest,
    });
  }

  rows.sort((a, b) => {
    const e = a.expKey.localeCompare(b.expKey);
    if (e !== 0) return e;
    if (a.strike !== b.strike) return a.strike - b.strike;
    return a.type.localeCompare(b.type);
  });

  return { rows, expKeys: chosen };
}

function fmtChainNum(n: number | undefined, decimals: number): string {
  if (n == null || !Number.isFinite(n)) return "-";
  return decimals === 0 ? String(Math.round(n)) : n.toFixed(decimals);
}

function formatOptionsChainBlock(chain: CachedChain, symbol: string): string {
  const { rows, expKeys } = collectChainRowsForChat(chain);
  const lines: string[] = [
    "### Options chain (|delta| 0.08–0.25, next 4 expirations)",
    `symbol=${symbol} underlying=${chain.underlyingPrice ?? "n/a"} fetchedAtMs=${chain.fetchedAt} totalCalls=${chain.totalCalls} totalPuts=${chain.totalPuts}`,
    `expirationsIncluded=${expKeys.join(", ") || "none"}`,
    "Columns: strike ty bid ask del iv oi (tab-separated; ty=C call P put)",
  ];

  if (rows.length === 0) {
    lines.push("(no contracts in delta band for selected expirations -- chain may lack greeks or use a different strike range)");
    return lines.join("\n");
  }

  let curExp = "";
  for (const r of rows) {
    if (r.expKey !== curExp) {
      curExp = r.expKey;
      lines.push("", `#### ${curExp}`, "strike	ty	bid	ask	del	iv	oi");
    }
    lines.push(
      [
        String(r.strike),
        r.type,
        fmtChainNum(r.bid, 2),
        fmtChainNum(r.ask, 2),
        fmtChainNum(r.delta, 4),
        fmtChainNum(r.iv, 4),
        fmtChainNum(r.oi, 0),
      ].join("	"),
    );
  }

  return lines.join("\n");
}

async function fetchOptionsChainForChatPack(
  symbol: string,
  accessToken: string | null | undefined,
  packLog: AiChatPackLog,
): Promise<string | null> {
  const tok = (accessToken ?? "").trim();
  if (!tok) {
    packLog.info({ symbol }, "aiChatContextPack: skip options chain (no Schwab token)");
    return null;
  }
  try {
    const chain = await getOrFetchChain(symbol, tok, packLog);
    if (!chain || (chain.calls.length === 0 && chain.puts.length === 0)) {
      packLog.warn({ symbol }, "aiChatContextPack: options chain empty");
      return null;
    }
    return formatOptionsChainBlock(chain, symbol);
  } catch (err) {
    packLog.warn({ err, symbol }, "aiChatContextPack: options chain fetch failed");
    return null;
  }
}

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
    `regularLast=${q.regularLast ?? "n/a"}`,
    `bid=${q.bid ?? "n/a"} bidSize=${q.bidSize ?? "n/a"}`,
    `ask=${q.ask ?? "n/a"} askSize=${q.askSize ?? "n/a"}`,
    `changePct=${q.changePct ?? "n/a"}`,
    `volume=${q.volume ?? "n/a"}`,
    `high=${q.high ?? "n/a"}`,
    `low=${q.low ?? "n/a"}`,
    `prevClose=${q.close ?? "n/a"}`,
    `quoteSource=${q.quoteSource ?? "unknown"}`,
    "note=Schwab LEVEL_ONE equity stream populates this cache on the API server when subscribed (not every ticker may be live-subscribed).",
  ];
  return parts.join(" ");
}

/** Wilder RSI on closing prices, oldest → newest. */
function computeWilderRsi14(closes: number[]): number | null {
  if (closes.length < 15) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= 14; i++) {
    const ch = closes[i]! - closes[i - 1]!;
    if (ch >= 0) gains += ch;
    else losses -= ch;
  }
  let avgGain = gains / 14;
  let avgLoss = losses / 14;
  for (let i = 15; i < closes.length; i++) {
    const ch = closes[i]! - closes[i - 1]!;
    avgGain = (avgGain * 13 + (ch > 0 ? ch : 0)) / 14;
    avgLoss = (avgLoss * 13 + (ch < 0 ? -ch : 0)) / 14;
  }
  if (avgLoss === 0) return avgGain > 0 ? 100 : null;
  const rs = avgGain / avgLoss;
  return Math.round((100 - 100 / (1 + rs)) * 100) / 100;
}

async function fetchSessionApproxVwapLine(sym: string): Promise<string> {
  const sessionDate = nyCalendarYmd(new Date());
  const rows = await db
    .select({
      high: schwabChartEquityBarsTable.high,
      low: schwabChartEquityBarsTable.low,
      close: schwabChartEquityBarsTable.close,
      volume: schwabChartEquityBarsTable.volume,
    })
    .from(schwabChartEquityBarsTable)
    .where(
      and(
        eq(schwabChartEquityBarsTable.symbol, sym),
        eq(schwabChartEquityBarsTable.sessionDate, sessionDate),
      ),
    )
    .orderBy(asc(schwabChartEquityBarsTable.barTimeMs));
  if (rows.length === 0) {
    return `sessionApproxVwap=n/a (no schwab_chart_equity_bars rows for ${sym} sessionDate=${sessionDate} — CHART_EQUITY 1m stream may not be persisting for this symbol yet)`;
  }
  let pv = 0;
  let vol = 0;
  for (const r of rows) {
    const h = Number(r.high);
    const l = Number(r.low);
    const cl = Number(r.close);
    const v = Number(r.volume);
    if (!Number.isFinite(v) || v <= 0) continue;
    if (!Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(cl)) continue;
    const tp = (h + l + cl) / 3;
    pv += tp * v;
    vol += v;
  }
  const vwap = vol > 0 ? Math.round((pv / vol) * 100) / 100 : null;
  return `sessionApproxVwap_hlc3_volumeWeighted=${vwap ?? "n/a"} sessionDate=${sessionDate} barCount=${rows.length} (from persisted Schwab CHART_EQUITY 1m bars; aligns with RTH session when bars exist)`;
}

async function fetchDailyRsi14Line(sym: string): Promise<string> {
  const rows = await db
    .select({ close: equityDailyTable.close, date: equityDailyTable.date })
    .from(equityDailyTable)
    .where(eq(equityDailyTable.symbol, sym))
    .orderBy(desc(equityDailyTable.date))
    .limit(80);
  if (rows.length < 15) {
    return `RSI14=n/a (need ≥15 daily closes in equity_daily for ${sym}; have ${rows.length})`;
  }
  const chrono = [...rows].reverse();
  const closes = chrono.map((r) => Number(r.close)).filter((n) => Number.isFinite(n));
  if (closes.length < 15) return `RSI14=n/a (non-numeric closes in equity_daily for ${sym})`;
  const rsi = computeWilderRsi14(closes);
  const asOfRaw = chrono[chrono.length - 1]?.date as unknown;
  const asOf =
    asOfRaw instanceof Date ? asOfRaw.toISOString().slice(0, 10) : String(asOfRaw ?? "");
  return `RSI14_wilder=${rsi ?? "n/a"} asOfDailyClose=${asOf} lookbackDays=${closes.length} (computed from equity_daily closes; differs from intraday RSI)`;
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
  /** Schwab OAuth token for `/chains` (same cache as GET /api/market/options). Omit to skip chain block. */
  schwabAccessToken?: string | null;
  /** Request-scoped logger (e.g. `req.log`); defaults to module logger. */
  packLog?: AiChatPackLog;
}

export type AiChatContextPackResult = {
  /** Markdown sections joined for the system prompt. */
  markdown: string;
  /** True when FMP stock_news returned zero rows or the API key is missing. */
  fmpHeadlinesEmpty: boolean;
};

/**
 * Returns a large markdown-ish text block appended under Schwab quote context.
 * Safe to concatenate into the system prompt.
 */
export async function buildAiChatContextPack(input: AiChatContextPackInput): Promise<AiChatContextPackResult> {
  const sym = input.symbol.toUpperCase().trim();
  if (!sym) {
    return { markdown: "(No symbol — terminal context pack skipped.)", fmpHeadlinesEmpty: true };
  }

  const packLog: AiChatPackLog = input.packLog ?? logger;
  const sections: string[] = [];

  const cached = getQuoteBySymbol(sym);
  if (cached) {
    sections.push("### Server Schwab / streamer quote cache\n" + formatLiveQuote(sym, cached));
  } else {
    sections.push(
      "### Server Schwab / streamer quote cache\n"
        + "(no cached equity quote for this symbol on the API server — Schwab LEVEL_ONE stream may not be subscribed for this ticker on the API process, or quotes are only on the client)",
    );
  }

  const [ivr, earnings, fmpLines, techBlock, chainBlock] = await Promise.all([
    getStoredIVR(sym),
    getNextEarningsDate(sym).catch(() => null),
    fetchFmpHeadlines(sym),
    (async () => {
      const [v, r, bb] = await Promise.all([
        fetchSessionApproxVwapLine(sym),
        fetchDailyRsi14Line(sym),
        fetchDailyBollinger20Line(sym),
      ]);
      return `${v}\n${r}\n${bb}`;
    })(),
    fetchOptionsChainForChatPack(sym, input.schwabAccessToken, packLog),
  ]);

  sections.push("### Intraday / daily technicals (server)\n" + techBlock);

  if (chainBlock) {
    sections.push(chainBlock);
  }

  let highlights: PolygonFlowHighlights | null = await getPolygonFlowHighlights(sym);
  const coldAug = await augmentPolygonColdTickerForChat({
    symbol: sym,
    lastUserMessage: input.lastUserMessage ?? "",
    highlightsBefore: highlights,
    packLog,
  });
  if (coldAug.section) {
    sections.push(coldAug.section);
  }
  if (coldAug.highlights !== undefined) {
    highlights = coldAug.highlights;
  }

  let liveTapeCaptureMarkdown = "";

  if (highlights?.sessionTape?.tapeKind === "eod_fallback" && !coldAug.tierBCaptureAttempted) {
    try {
      const fc = await requestFlowCapture(sym, {
        timeout: 12_000,
        minDurationMs: 1_500,
      });
      const tb = fc.tapeBackfill;
      const refreshed = await getPolygonFlowHighlights(sym, tb);
      if (refreshed) highlights = refreshed;
      liveTapeCaptureMarkdown =
        "### Live options tape (on-demand for this chat request)\n"
        + `- Ran server flow capture so classified prints can populate the DB before building this pack.\n`
        + `- sessionDate=${fc.sessionDate} source=${fc.source} durationMs=${fc.durationMs} rowsInserted=${fc.rowsInserted}\n`
        + `- errors: ${fc.errors.length ? fc.errors.join("; ") : "none"}\n`
        + (tb
          ? `- tapeBackfill: status=${tb.status ?? "?"} tradesInserted=${tb.tradesInserted ?? 0} occRequested=${tb.occRequested ?? 0} occCompleted=${tb.occCompleted ?? 0}\n`
          : "");
      logger.info(
        { sym, rowsInserted: fc.rowsInserted, sessionDate: fc.sessionDate, tape: tb?.status },
        "aiChatContextPack: on-demand flow capture for chat",
      );
    } catch (err) {
      logger.warn({ err, sym }, "aiChatContextPack: on-demand flow capture failed");
      liveTapeCaptureMarkdown =
        "### Live options tape (on-demand for this chat request)\n"
        + `- captureError: ${err instanceof Error ? err.message : String(err)}\n`;
    }
  }

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

  if (liveTapeCaptureMarkdown) {
    sections.push(liveTapeCaptureMarkdown.trimEnd());
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

  const fmpHeadlinesEmpty = fmpLines.length === 0;
  return { markdown: sections.join("\n\n"), fmpHeadlinesEmpty };
}
