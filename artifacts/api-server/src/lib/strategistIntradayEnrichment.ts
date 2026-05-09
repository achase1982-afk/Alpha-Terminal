import { db, eq, tickerSignalSnapshotTable } from "@workspace/db";
import { logger } from "./logger.js";
import { nyCalendarYmd, prevNyTradingDayYmd, rthBoundsMs } from "./polygonMarketCalendar.js";
import { isUsEquityRthEt } from "./ibTotalviewPersistence.js";
import { getIbTuningL1QuoteSnapshot } from "./ibStreamer.js";
import {
  addChartEquitySymbols,
  addNasdaqBookSymbols,
  addNyseBookSymbols,
  addOptionSymbols,
  addSymbols,
  addTimesaleEquitySymbols,
  computeSchwabBookMetrics,
  getOptionTick,
  getSchwabStreamEquityQuoteFresh,
  getSchwabVenueBookStrategistSnapshot,
  getStrategistChartEquityBars,
  getStrategistTimesalePoints,
  type SchwabChartEquityBarPoint,
  type SchwabTimesaleStrategistPoint,
} from "./schwabStreamer.js";
import { buildSchwabOptionStreamerKey } from "./schwabOptionOccKey.js";
import type { LiquidCorePrimaryListing } from "../data/liquidCore130.js";

/** Minimal chain row shape for option OCC keys (avoids circular import with strategistV2). */
export type StrategistChainContractRef = {
  strike: number;
  expiration: string;
  type: string;
  optionType?: string;
};

const STREAM_BOOK_MAX_AGE_MS = 30_000;
const IBKR_L1_MAX_AGE_MS = 5_000;
const SCHWAB_STREAM_QUOTE_MAX_AGE_MS = 10_000;
const OPTIONS_STREAM_MAX_AGE_MS = 10_000;
const SIGNAL_SNAPSHOT_WARN_SECONDS = 5 * 60;

const BLOCK_WINDOW_MS = 30 * 60 * 1000;
const BLOCK_MIN_SHARES = 10_000;
const BLOCK_MIN_NOTIONAL_USD = 1_000_000;

export type StrategistBookVenue = "NYSE" | "NASDAQ" | "UNKNOWN";

/** Subscribe strategist ticker to Schwab streams (additive). */
export function ensureStrategistSchwabSubscriptions(ticker: string, venue: StrategistBookVenue): void {
  const u = ticker.toUpperCase().replace(/^\$/, "");
  try {
    addSymbols([u]);
    addTimesaleEquitySymbols([u]);
    addChartEquitySymbols([u]);
    addOptionSymbols([u]);
    if (venue === "NASDAQ") addNasdaqBookSymbols([u]);
    else if (venue === "NYSE") addNyseBookSymbols([u]);
    else {
      addNyseBookSymbols([u]);
      addNasdaqBookSymbols([u]);
    }
  } catch (err) {
    logger.warn({ err, ticker: u }, "StrategistIntraday: Schwab subscription helpers threw");
  }
}

function venueFromListing(
  listing: LiquidCorePrimaryListing | "OTHER_US" | null | undefined,
): StrategistBookVenue {
  if (listing === "NASDAQ") return "NASDAQ";
  if (listing === "NYSE" || listing === "ARCA" || listing === "AMEX") return "NYSE";
  return "UNKNOWN";
}

export function resolveStrategistBookVenue(
  listing: LiquidCorePrimaryListing | "OTHER_US" | null | undefined,
): StrategistBookVenue {
  return venueFromListing(listing);
}

function computeRsiWilders(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) changes.push(closes[i]! - closes[i - 1]!);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    const ch = changes[i]!;
    if (ch >= 0) avgGain += ch;
    else avgLoss -= ch;
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period; i < changes.length; i++) {
    const ch = changes[i]!;
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round((100 - 100 / (1 + rs)) * 100) / 100;
}

/** Share-volume-weighted session VWAP from Schwab TIMESALE_EQUITY prints in `[openMs, closeMs]` only. */
function sessionVwapFromTimesales(
  pts: SchwabTimesaleStrategistPoint[],
  openMs: number,
  closeMs: number,
): number | null {
  let num = 0;
  let den = 0;
  for (const p of pts) {
    if (p.ts < openMs || p.ts > closeMs) continue;
    num += p.price * p.size;
    den += p.size;
  }
  if (den <= 0 || num <= 0) return null;
  return Math.round((num / den) * 10000) / 10000;
}

function sessionVwapFromChartBars(
  bars: readonly SchwabChartEquityBarPoint[],
  openMs: number,
  closeMs: number,
): number | null {
  let num = 0;
  let den = 0;
  for (const b of bars) {
    const t = b.chartTimeMs;
    if (t < openMs || t > closeMs) continue;
    const v = b.volume;
    if (v <= 0 || !Number.isFinite(v)) continue;
    const typical = (b.high + b.low + b.close) / 3;
    if (!Number.isFinite(typical) || typical <= 0) continue;
    num += typical * v;
    den += v;
  }
  if (den <= 0) return null;
  return Math.round((num / den) * 10000) / 10000;
}

/** ET calendar minute key for aligning tape prints with chart bars (America/New_York wall clock). */
function etMinuteKey(tsMs: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(tsMs));
  const g = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`;
}

/**
 * Merge Schwab minute buckets: chart fills history; TIMESALE last print overrides the same ET minute.
 * Last fifteen closes feed Wilder's RSI (walks back across sessions via retained bars/tape).
 */
function rsiFromSchwabMinuteMerge(
  tsPts: SchwabTimesaleStrategistPoint[],
  chartBars: readonly SchwabChartEquityBarPoint[],
): { rsi: number | null; rsi_as_of_session_date: string | null } {
  const minuteToClose = new Map<string, number>();
  for (const c of chartBars) {
    const k = etMinuteKey(c.chartTimeMs);
    if (Number.isFinite(c.close) && c.close > 0 && !minuteToClose.has(k)) {
      minuteToClose.set(k, c.close);
    }
  }
  for (const p of tsPts) {
    minuteToClose.set(etMinuteKey(p.ts), p.price);
  }
  const keys = [...minuteToClose.keys()].sort();
  if (keys.length < 15) return { rsi: null, rsi_as_of_session_date: null };
  const last15 = keys.slice(-15);
  const closes = last15.map((k) => minuteToClose.get(k)!);
  const rsi = computeRsiWilders(closes, 14);
  const lastKey = last15[last15.length - 1]!;
  const dayPart = lastKey.slice(0, 10);
  return {
    rsi,
    rsi_as_of_session_date: rsi != null ? dayPart : null,
  };
}

function equityBlockMetricsWindow(
  pts: SchwabTimesaleStrategistPoint[],
  windowStartMs: number,
  windowEndMs: number,
  sessionOpenMs: number,
  sessionCloseMs: number,
  spotPrice: number,
  nowMsForAge: number,
): {
  block_count_30min: number | null;
  block_notional_30min: number | null;
  block_side_imbalance: number | null;
  last_block_age_seconds: number | null;
} {
  let buyN = 0;
  let sellN = 0;
  let blockCount = 0;
  let totalBlockNotional = 0;
  let lastBlockTs: number | null = null;

  let sessionVwapNum = 0;
  let sessionVwapDen = 0;
  for (const p of pts) {
    if (p.ts >= sessionOpenMs && p.ts <= sessionCloseMs) {
      sessionVwapNum += p.price * p.size;
      sessionVwapDen += p.size;
    }
  }
  const sessVwap =
    sessionVwapDen > 0 ? sessionVwapNum / sessionVwapDen : spotPrice > 0 ? spotPrice : null;

  for (const p of pts) {
    if (p.ts < windowStartMs || p.ts > windowEndMs) continue;
    const notional = p.price * p.size;
    const isBlock = p.size >= BLOCK_MIN_SHARES || notional >= BLOCK_MIN_NOTIONAL_USD;
    if (!isBlock) continue;
    blockCount++;
    totalBlockNotional += notional;
    lastBlockTs = p.ts;
    if (sessVwap != null && sessVwap > 0) {
      if (p.price > sessVwap) buyN += notional;
      else if (p.price < sessVwap) sellN += notional;
    }
  }

  let imbalance: number | null = null;
  const pairSum = buyN + sellN;
  if (pairSum > 0) imbalance = Math.round(((buyN - sellN) / pairSum) * 10_000) / 10_000;

  let lastAgeSec: number | null = null;
  if (lastBlockTs != null) lastAgeSec = Math.max(0, Math.round((nowMsForAge - lastBlockTs) / 1000));

  if (blockCount === 0) {
    return {
      block_count_30min: 0,
      block_notional_30min: 0,
      block_side_imbalance: imbalance,
      last_block_age_seconds: null,
    };
  }

  return {
    block_count_30min: blockCount,
    block_notional_30min: Math.round(totalBlockNotional * 100) / 100,
    block_side_imbalance: imbalance,
    last_block_age_seconds: lastAgeSec,
  };
}

function equityBlockMetrics(
  pts: SchwabTimesaleStrategistPoint[],
  sessionOpenMs: number,
  sessionCloseMs: number,
  spotPrice: number,
  nowMs: number,
): {
  block_count_30min: number | null;
  block_notional_30min: number | null;
  block_side_imbalance: number | null;
  last_block_age_seconds: number | null;
} {
  const windowStart = nowMs - BLOCK_WINDOW_MS;
  return equityBlockMetricsWindow(pts, windowStart, nowMs, sessionOpenMs, sessionCloseMs, spotPrice, nowMs);
}

function pickVenueForBook(
  venue: StrategistBookVenue,
): "NYSE" | "NASDAQ" | null {
  if (venue === "NYSE") return "NYSE";
  if (venue === "NASDAQ") return "NASDAQ";
  return null;
}

export async function buildStrategistIntradayPackage(args: {
  ticker: string;
  spotPrice: number;
  listing: LiquidCorePrimaryListing | "OTHER_US" | null | undefined;
  chain: readonly StrategistChainContractRef[];
}): Promise<{
  intraday: Record<string, unknown>;
  schwab_stream_bid: number | null;
  schwab_stream_ask: number | null;
  schwab_stream_last: number | null;
  schwab_stream_age_ms: number | null;
  ibkr_l1_bid: number | null;
  ibkr_l1_ask: number | null;
  ibkr_l1_last: number | null;
  ibkr_l1_age_ms: number | null;
  ibkr_schwab_quote_delta_bps: number | null;
  options_data_freshness: Record<string, unknown>;
}> {
  const symU = args.ticker.toUpperCase().replace(/^\$/, "");
  const venue = resolveStrategistBookVenue(args.listing);
  const nowMs = Date.now();
  const nyYmd = nyCalendarYmd(new Date());
  let openMs = nowMs - 8 * 60 * 60 * 1000;
  let closeMs = nowMs + 60 * 60 * 1000;
  try {
    const b = await rthBoundsMs(nyYmd);
    openMs = b.openMs;
    closeMs = b.closeMs;
  } catch {
    /* keep defaults */
  }

  const tsPts = getStrategistTimesalePoints(symU);
  const chartBars = getStrategistChartEquityBars(symU);

  let vwapSession = sessionVwapFromTimesales(tsPts, openMs, closeMs);
  let vwapStatus: string =
    vwapSession != null ? "live_from_timesale_session" : "insufficient_timesale_ticks";
  let vwap_as_of_session_date: string | null = vwapSession != null ? nyYmd : null;

  if (vwapSession == null) {
    let dayCursor = await prevNyTradingDayYmd(nyYmd);
    for (let i = 0; i < 15; i++) {
      try {
        const bounds = await rthBoundsMs(dayCursor);
        const tsV = sessionVwapFromTimesales(tsPts, bounds.openMs, bounds.closeMs);
        if (tsV != null) {
          vwapSession = tsV;
          vwapStatus = "prior_session_timesales";
          vwap_as_of_session_date = dayCursor;
          break;
        }
        const cv = sessionVwapFromChartBars(chartBars, bounds.openMs, bounds.closeMs);
        if (cv != null) {
          vwapSession = cv;
          vwapStatus = "prior_session_chart_equity";
          vwap_as_of_session_date = dayCursor;
          break;
        }
      } catch {
        /* try next session */
      }
      dayCursor = await prevNyTradingDayYmd(dayCursor);
    }
  }

  const spot = args.spotPrice > 0 ? args.spotPrice : null;
  let vwapDeltaPct: number | null = null;
  if (vwapSession != null && vwapSession > 0 && spot != null) {
    vwapDeltaPct = Math.round(((spot - vwapSession) / vwapSession) * 10000) / 100;
  }

  const rsiMerged = rsiFromSchwabMinuteMerge(tsPts, chartBars);
  const rsi14 = rsiMerged.rsi;
  const rsiStatus = rsi14 != null ? "available" : "insufficient_schwab_minute_closes";
  const rsi_as_of_session_date = rsiMerged.rsi_as_of_session_date;

  let blocks = equityBlockMetrics(tsPts, openMs, closeMs, args.spotPrice || 0, nowMs);
  let equity_block_tape_as_of_session_date: string | null = null;
  const hadCurrentBlocks =
    (blocks.block_count_30min ?? 0) > 0 || (blocks.block_notional_30min ?? 0) > 0;
  if (hadCurrentBlocks) {
    equity_block_tape_as_of_session_date = nyYmd;
  } else {
    try {
      const prevDay = await prevNyTradingDayYmd(nyYmd);
      const pb = await rthBoundsMs(prevDay);
      const ws = pb.closeMs - BLOCK_WINDOW_MS;
      const we = pb.closeMs;
      blocks = equityBlockMetricsWindow(tsPts, ws, we, pb.openMs, pb.closeMs, args.spotPrice || 0, nowMs);
      equity_block_tape_as_of_session_date = prevDay;
    } catch {
      equity_block_tape_as_of_session_date = null;
    }
  }

  const venuePick = pickVenueForBook(venue);
  let orderBookPayload: Record<string, unknown> = {
    top_of_book_bid_size: null,
    top_of_book_ask_size: null,
    book_imbalance_pct: null,
    depth_within_1pct_bid: null,
    depth_within_1pct_ask: null,
    book_age_ms: null,
    venue: venuePick,
  };

  const venuesToTry: Array<"NYSE" | "NASDAQ"> =
    venuePick != null ? [venuePick] : ["NASDAQ", "NYSE"];
  let bestFresh: {
    snap: NonNullable<ReturnType<typeof getSchwabVenueBookStrategistSnapshot>>;
    v: "NYSE" | "NASDAQ";
    age: number;
  } | null = null;
  let stalest: {
    snap: NonNullable<ReturnType<typeof getSchwabVenueBookStrategistSnapshot>>;
    v: "NYSE" | "NASDAQ";
    age: number;
  } | null = null;
  for (const v of venuesToTry) {
    const snap = getSchwabVenueBookStrategistSnapshot(symU, v);
    if (!snap) continue;
    const age = nowMs - snap.recvTs;
    const row = { snap, v, age };
    if (age <= STREAM_BOOK_MAX_AGE_MS) {
      if (!bestFresh || age < bestFresh.age) bestFresh = row;
    } else if (!stalest || age < stalest.age) stalest = row;
  }
  const chosen = bestFresh ?? stalest;
  if (chosen) {
    if (chosen.age <= STREAM_BOOK_MAX_AGE_MS) {
      const m = computeSchwabBookMetrics(chosen.snap.rawBids, chosen.snap.rawAsks);
      orderBookPayload = {
        top_of_book_bid_size: m.topOfBookBidSize,
        top_of_book_ask_size: m.topOfBookAskSize,
        book_imbalance_pct: m.bookImbalancePct,
        depth_within_1pct_bid: m.depthWithin1pctBid,
        depth_within_1pct_ask: m.depthWithin1pctAsk,
        book_age_ms: chosen.age,
        venue: chosen.v,
      };
    } else {
      orderBookPayload = {
        top_of_book_bid_size: null,
        top_of_book_ask_size: null,
        book_imbalance_pct: null,
        depth_within_1pct_bid: null,
        depth_within_1pct_ask: null,
        book_age_ms: chosen.age,
        venue: chosen.v,
      };
    }
  }

  const schwabQ = getSchwabStreamEquityQuoteFresh(symU, SCHWAB_STREAM_QUOTE_MAX_AGE_MS);
  let schwab_stream_bid: number | null = null;
  let schwab_stream_ask: number | null = null;
  let schwab_stream_last: number | null = null;
  let schwab_stream_age_ms: number | null = null;
  if (schwabQ) {
    schwab_stream_bid = schwabQ.bid;
    schwab_stream_ask = schwabQ.ask;
    schwab_stream_last = schwabQ.last ?? schwabQ.regularLast;
    schwab_stream_age_ms = nowMs - schwabQ.ts;
  }

  const ibRaw = getIbTuningL1QuoteSnapshot(symU);
  let ibkr_l1_bid: number | null = null;
  let ibkr_l1_ask: number | null = null;
  let ibkr_l1_last: number | null = null;
  let ibkr_l1_age_ms: number | null = null;
  if (ibRaw && ibRaw.ageMs <= IBKR_L1_MAX_AGE_MS) {
    ibkr_l1_bid = ibRaw.bid;
    ibkr_l1_ask = ibRaw.ask;
    ibkr_l1_last = ibRaw.last;
    ibkr_l1_age_ms = ibRaw.ageMs;
  } else if (ibRaw) {
    ibkr_l1_age_ms = ibRaw.ageMs;
  }

  let ibkr_schwab_quote_delta_bps: number | null = null;
  if (
    schwabQ &&
    ibRaw &&
    ibRaw.ageMs <= IBKR_L1_MAX_AGE_MS &&
    schwabQ.bid != null &&
    schwabQ.ask != null &&
    ibRaw.bid != null &&
    ibRaw.ask != null
  ) {
    const midS = (schwabQ.bid + schwabQ.ask) / 2;
    const midI = (ibRaw.bid + ibRaw.ask) / 2;
    if (midS > 0) ibkr_schwab_quote_delta_bps = Math.round(((midI - midS) / midS) * 10000);
  }

  const { freshness, maxQuoteAgeMs, liveBacked, restOnly } = computeOptionsStreamFreshness(args.chain, symU);

  let signalSnapshot: Record<string, unknown> | null = null;
  try {
    const rows = await db
      .select()
      .from(tickerSignalSnapshotTable)
      .where(eq(tickerSignalSnapshotTable.ticker, symU))
      .limit(1);
    const row = rows[0];
    if (row?.snapshotAt) {
      const sa = row.snapshotAt instanceof Date ? row.snapshotAt.getTime() : new Date(row.snapshotAt).getTime();
      const snapshot_age_seconds = Math.max(0, Math.round((nowMs - sa) / 1000));
      signalSnapshot = {
        ticker: row.ticker,
        sector: row.sector,
        market_cap_tier: row.marketCapTier,
        spot: row.spot,
        daily_change_pct: row.dailyChangePct,
        composite_score: row.compositeScore,
        component_scores: row.componentScores,
        flow_summary: row.flowSummary,
        snapshot_at: row.snapshotAt instanceof Date ? row.snapshotAt.toISOString() : String(row.snapshotAt),
        snapshot_age_seconds,
      };
      if (snapshot_age_seconds > SIGNAL_SNAPSHOT_WARN_SECONDS && isUsEquityRthEt()) {
        logger.warn(
          { ticker: symU, snapshot_age_seconds },
          "StrategistIntraday: ticker_signal_snapshot older than 5 minutes during regular session hours",
        );
      }
    }
  } catch (err) {
    logger.warn({ err, ticker: symU }, "StrategistIntraday: ticker_signal_snapshot read failed");
  }

  const intraday: Record<string, unknown> = {
    vwap: {
      vwap_session: vwapSession,
      vwap_delta_pct: vwapDeltaPct,
      vwap_status: vwapStatus,
      vwap_as_of_session_date,
    },
    rsi: {
      rsi_14: rsi14,
      rsi_status: rsiStatus,
      rsi_as_of_session_date,
    },
    equity_block_tape: {
      ...blocks,
      equity_block_tape_as_of_session_date,
    },
    order_book: orderBookPayload,
    signal_snapshot: signalSnapshot,
  };

  const options_data_freshness = {
    source: freshness,
    max_quote_age_ms: maxQuoteAgeMs,
    contracts_live_stream_backed: liveBacked,
    contracts_rest_only: restOnly,
  };

  return {
    intraday,
    schwab_stream_bid,
    schwab_stream_ask,
    schwab_stream_last,
    schwab_stream_age_ms,
    ibkr_l1_bid,
    ibkr_l1_ask,
    ibkr_l1_last,
    ibkr_l1_age_ms,
    ibkr_schwab_quote_delta_bps,
    options_data_freshness,
  };
}

function computeOptionsStreamFreshness(
  chain: readonly StrategistChainContractRef[],
  underlyingUpper: string,
): {
  freshness: string;
  maxQuoteAgeMs: number | null;
  liveBacked: number;
  restOnly: number;
} {
  const now = Date.now();
  let liveBacked = 0;
  let restOnly = 0;
  let maxAge = 0;
  const symRoot = underlyingUpper.replace(/^\$/, "").slice(0, 8);
  let examined = 0;
  const maxExamine = 400;
  for (const c of chain) {
    if (examined >= maxExamine) break;
    const ot = (c.optionType ?? c.type ?? "CALL").toString().toUpperCase();
    const isPut = ot === "P" || ot.includes("PUT");
    const occKey = buildSchwabOptionStreamerKey(symRoot, c.expiration, c.strike, isPut ? "PUT" : "CALL");
    if (!occKey) {
      restOnly++;
      examined++;
      continue;
    }
    const tick = getOptionTick(occKey);
    examined++;
    if (!tick) {
      restOnly++;
      continue;
    }
    const age = now - tick.ts;
    if (age <= OPTIONS_STREAM_MAX_AGE_MS) {
      liveBacked++;
      if (age > maxAge) maxAge = age;
    } else {
      restOnly++;
      if (age > maxAge) maxAge = age;
    }
  }
  let freshness = "schwab_rest_chain_only";
  if (liveBacked > 0 && restOnly > 0) freshness = "mixed_stream_and_rest";
  else if (liveBacked > 0 && restOnly === 0) freshness = "schwab_levelone_options_stream";
  return {
    freshness,
    maxQuoteAgeMs: maxAge > 0 ? maxAge : null,
    liveBacked,
    restOnly,
  };
}
