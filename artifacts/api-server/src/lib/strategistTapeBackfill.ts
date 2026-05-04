import { db, optionsFlowRawTradesTable, optionsTapeBackfillOccCacheTable } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { extractPgErrorContext, logFlowPipelineWarn } from "./flowPipelineInstrumentation.js";
import { getContract20dBaseline } from "./optionsBaselines.js";
import { fetchSchwabMarketSnapshot } from "./schwabMarketSnapshot.js";
import { buildMarketContextSnapshot } from "./flowMarketContext.js";
import {
  dteCalendarDays,
  sessionPhaseFromTradeMs,
  venueClassFromExchangeId,
} from "./flowTradeEnrichment.js";
import { classifyForFlowPersistence, shouldPersistBackfillRow } from "./optionsTradeClassifier.js";
import { reclassifyUnclassifiedTrades } from "./optionsTradeReclassifier.js";
import { flushFlowPersistenceNow } from "./optionsFlowPersistence.js";
import { runRollupOnceForSymbol } from "./optionsFlowRollup.js";
import { FlowLegWindow } from "./flowMultilegExtras.js";
import { upsertStrikeVolumeBaselineFromContractBaseline } from "./flowStrikeBaselineDaily.js";
import type { MarketCapTier } from "./flowMarketContext.js";
import {
  lastCompletedTradingDayNy,
  nyCalendarYmd,
  rthBoundsMs,
} from "./polygonMarketCalendar.js";
import { fetchPolygonPaged } from "./polygonPagedFetch.js";
import { type QuotePoint, nbboAtOrBefore, parseQuotes } from "./optionsQuoteNbbo.js";
import {
  OPTIONS_FLOW_RAW_TRADES_INSERT_MAX_ROWS,
  OPTIONS_FLOW_RAW_TRADES_ON_CONFLICT_SOURCE_DEDUPE,
} from "./optionsFlowRawTradesBulkInsert.js";
import pLimit from "p-limit";

const POLYGON_API = "https://api.polygon.io";
const MAX_EXPIRIES = 3;
const QUOTE_WINDOW_MS = 120_000;
const QUOTE_PREPAD_MS = 5_000;
/** Polygon max page size for /v3/trades and /v3/quotes (fewer round trips on liquid names). */
const TRADE_PAGE_LIMIT = 50_000;
const QUOTE_PAGE_LIMIT = 50_000;
/** Overall wall-clock budget for the whole symbol backfill (many OCC roots). */
const DEFAULT_BUDGET_MS = 180_000;
/** Phase 1: Polygon trades fetch only (half of default symbol budget). */
const PHASE_1_BUDGET_MS = 90_000;
/** Phase 2: quotes + aggressor classification + UPDATE (half of default symbol budget). */
const PHASE_2_BUDGET_MS = 90_000;
/** Hard cap on wall time spent inside a single OCC (fetch + classify + DB). */
const PER_ROOT_MAX_MS = 18_000;
/** Minimum slice reserved for each remaining OCC so progress stays fair vs one slow contract. */
const PER_ROOT_MIN_MS = 2_500;
/**
 * Concurrent OCC workers for REST tape backfill. Five balances Polygon rate limits (429 retries
 * in fetchPaged) against wall-clock latency. Increase only after observing 429 retry behavior under load.
 */
const CONCURRENCY = 5;

export type TapeBackfillStatusValue = "complete" | "partial" | "failed" | "skipped";

/** Why session tape is live, synthesized, or missing; surfaced on payloads for operators and LLMs. */
export type TapeBackfillDiagnosticReason =
  | "live_complete"
  | "live_partial"
  | "skipped_no_api_key"
  | "skipped_outside_rth"
  | "skipped_other"
  | "empty_polygon_response"
  | "empty_after_filter"
  | "polygon_error"
  | "timeout_no_inserts"
  | "already_persisted";

export interface TapeBackfillCoverageGeometry {
  /** Market-cap tier used to pick band width and OCC cap. */
  marketCapTier: MarketCapTier | string;
  maxOcc: number;
  strikesEachSide: number;
  /** Distinct (expiration, strike) nodes in the ATM band before OCC expansion. */
  bandNodeCount: number;
  /** OCC symbols in the band before volume ranking and cap (call+put legs). */
  occCandidatesBeforeCap: number;
}

/** Rows attempted vs inserted under ON CONFLICT DO NOTHING (existing source_trade_id). */
export interface TapeBackfillDedupeDrops {
  totalDropped: number;
  byOcc: Record<string, number>;
}

export interface TapeBackfillStatus {
  status: TapeBackfillStatusValue;
  reason: string | null;
  /** Structured cause for session tape quality (see TapeBackfillDiagnosticReason). */
  tapeBackfillReason: TapeBackfillDiagnosticReason;
  sessionDate: string;
  coverageEndMs: number;
  occRequested: number;
  /** Same as occRequested: length of OCC list processed (alias for diagnostics). */
  occListLength?: number;
  occCompleted: number;
  tradesInserted: number;
  /** Raw trade rows returned from Polygon before filtering (session window). */
  totalTradesFromPolygon: number;
  /** Rows rejected by classifier before persistence. */
  persistRejectedCount: number;
  anyTruncated: boolean;
  anyError?: boolean;
  /** True if any Polygon REST response in this run was non-OK HTTP (excluding handled 429 retries). */
  anySawPolygonHttpError: boolean;
  todayYmd: string;
  isSessionForToday: boolean;
  sessionInProgress: boolean;
  queryOpenMs: number;
  queryCloseMs: number;
  /** flowCaptureService: how rows were loaded for this session. */
  captureSource?: "websocket" | "rest" | "flat_file";
  /** Wall time spent in flow capture (when captureSource is set). */
  captureDurationMs?: number;
  /**
   * WebSocket subscription list length when flow capture subscribed to OCCs for live tape.
   * REST coverage remains on {@link occRequested} / {@link occCompleted}; do not conflate.
   */
  wsOccSubscribed?: number;
  /** How session tape OCCs were chosen (tiered band + volume-ranked cap). */
  coverageGeometry?: TapeBackfillCoverageGeometry;
  /** REST insert dedupe: rows skipped because they matched an existing print key for this session. */
  tapeBackfillDedupeDrops?: TapeBackfillDedupeDrops;
}

interface ChainLike {
  strike: number;
  expiration: string;
  type: string;
  optionType?: string;
  openInterest?: number;
  volume?: number;
}

interface CuratedExp {
  expiration: string;
  dte: number;
}

export interface ChainSummaryLike {
  atmStrike: number;
  availableExpirations: string[];
  curatedExpirations: CuratedExp[];
}

function chainToOcc(underlying: string, expiration: string, strike: number, isCall: boolean): string {
  const root = underlying.toUpperCase().replace(/\s+/g, "");
  const [Y, M, D] = expiration.split("-");
  if (!Y || !M || !D) return "";
  const yymmdd = `${Y.slice(2)}${M.padStart(2, "0")}${D.padStart(2, "0")}`;
  const cp = isCall ? "C" : "P";
  const strike8 = String(Math.round(strike * 1000)).padStart(8, "0");
  return `O:${root}${yymmdd}${cp}${strike8}`;
}

function dteFromEtToday(expiration: string): number {
  const expMs = new Date(`${expiration}T20:00:00Z`).getTime();
  const ymd = nyCalendarYmd(new Date());
  const dayMs = new Date(`${ymd}T17:00:00`).getTime();
  return Math.max(0, Math.round((expMs - dayMs) / 86_400_000));
}

function pickExpiries(summary: ChainSummaryLike): string[] {
  const fromCurated = [...summary.curatedExpirations]
    .filter((e) => e.dte > 0 && e.dte <= 120)
    .sort((a, b) => a.dte - b.dte)
    .map((e) => e.expiration);
  const nearest = [...summary.availableExpirations]
    .map((exp) => ({ exp, dte: dteFromEtToday(exp) }))
    .filter((x) => x.dte > 0 && x.dte <= 45)
    .sort((a, b) => a.dte - b.dte)[0]?.exp;
  const ordered: string[] = [];
  if (nearest) ordered.push(nearest);
  for (const e of fromCurated) {
    if (!ordered.includes(e)) ordered.push(e);
    if (ordered.length >= MAX_EXPIRIES) break;
  }
  for (const e of fromCurated) {
    if (ordered.length >= MAX_EXPIRIES) break;
    if (!ordered.includes(e)) ordered.push(e);
  }
  return ordered.slice(0, MAX_EXPIRIES);
}

/** Tiered tape sampling: mega/large (and index ETFs) get wider band + higher OCC cap. */
export function tapeBackfillSamplingFromTier(tier: MarketCapTier | string): { maxOcc: number; strikesEachSide: number } {
  const t = tier as MarketCapTier;
  if (t === "mega" || t === "large" || t === "etf_index") return { maxOcc: 200, strikesEachSide: 15 };
  if (t === "mid" || t === "etf_sector") return { maxOcc: 75, strikesEachSide: 10 };
  return { maxOcc: 50, strikesEachSide: 5 };
}

function strikesAroundAtm(atm: number, chain: ChainLike[], expiration: string, strikesEachSide: number): number[] {
  const strikes = new Set<number>();
  for (const c of chain) {
    if (c.expiration !== expiration) continue;
    strikes.add(c.strike);
  }
  return [...strikes].sort((a, b) => Math.abs(a - atm) - Math.abs(b - atm)).slice(0, strikesEachSide * 2 + 1);
}

function legVolume(chain: ChainLike[], expiration: string, strike: number, isCall: boolean): number {
  for (const c of chain) {
    if (c.expiration !== expiration || c.strike !== strike) continue;
    const ot = String(c.optionType ?? c.type).toUpperCase();
    const legCall = ot === "CALL" || c.type === "call";
    const legPut = ot === "PUT" || c.type === "put";
    if (isCall && !legCall) continue;
    if (!isCall && !legPut) continue;
    const v = c.volume;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return Math.floor(v);
  }
  return 0;
}

export interface TapeOccBuildResult {
  occs: string[];
  coverageGeometry: TapeBackfillCoverageGeometry;
}

export function buildTapeOccList(
  underlying: string,
  chain: ChainLike[],
  summary: ChainSummaryLike,
  tier: MarketCapTier | string,
): TapeOccBuildResult {
  const { maxOcc, strikesEachSide } = tapeBackfillSamplingFromTier(tier);
  const u = underlying.toUpperCase();
  const exps = pickExpiries(summary);
  const atm = summary.atmStrike;
  const bandNodes = new Set<string>();
  const occRows: { occ: string; vol: number }[] = [];
  const seenOcc = new Set<string>();

  for (const exp of exps) {
    for (const strike of strikesAroundAtm(atm, chain, exp, strikesEachSide)) {
      bandNodes.add(`${exp}|${strike}`);
      const hasCall = chain.some(
        (c) =>
          c.expiration === exp &&
          c.strike === strike &&
          ((c.optionType ?? c.type).toUpperCase() === "CALL" || c.type === "call"),
      );
      const hasPut = chain.some(
        (c) =>
          c.expiration === exp &&
          c.strike === strike &&
          ((c.optionType ?? c.type).toUpperCase() === "PUT" || c.type === "put"),
      );
      if (hasCall) {
        const occ = chainToOcc(u, exp, strike, true);
        if (occ && !seenOcc.has(occ)) {
          seenOcc.add(occ);
          occRows.push({ occ, vol: legVolume(chain, exp, strike, true) });
        }
      }
      if (hasPut) {
        const occ = chainToOcc(u, exp, strike, false);
        if (occ && !seenOcc.has(occ)) {
          seenOcc.add(occ);
          occRows.push({ occ, vol: legVolume(chain, exp, strike, false) });
        }
      }
    }
  }

  occRows.sort((a, b) => b.vol - a.vol || a.occ.localeCompare(b.occ));
  const occs = occRows.slice(0, maxOcc).map((r) => r.occ);
  const coverageGeometry: TapeBackfillCoverageGeometry = {
    marketCapTier: tier,
    maxOcc,
    strikesEachSide,
    bandNodeCount: bandNodes.size,
    occCandidatesBeforeCap: occRows.length,
  };
  return { occs, coverageGeometry };
}

function openInterestForOcc(chain: ChainLike[], meta: { expiration: string; strike: number; optionType: "call" | "put" }): number {
  const isCall = meta.optionType === "call";
  for (const c of chain) {
    if (c.expiration !== meta.expiration || c.strike !== meta.strike) continue;
    const ot = String(c.optionType ?? c.type).toUpperCase();
    const legCall = ot === "CALL" || c.type === "call";
    const legPut = ot === "PUT" || c.type === "put";
    if (isCall && !legCall) continue;
    if (!isCall && !legPut) continue;
    const oi = c.openInterest;
    if (typeof oi === "number" && Number.isFinite(oi) && oi >= 0) return Math.floor(oi);
  }
  return 0;
}

function tradeDedupId(occ: string, row: Record<string, unknown>): string {
  const sip = BigInt(String(row["sip_timestamp"] ?? row["participant_timestamp"] ?? 0));
  const part = BigInt(String(row["participant_timestamp"] ?? 0));
  const px = Number(row["price"] ?? 0);
  const sz = Number(row["size"] ?? 0);
  const ex = Number(row["exchange"] ?? 0);
  return `rest:${occ}:${sip}:${part}:${px}:${sz}:${ex}`;
}

function nsToMs(ns: bigint): number {
  return Number(ns / 1_000_000n);
}

interface ParsedTrade {
  tsMs: number;
  price: number;
  size: number;
  conditions: number[];
  dedupId: string;
  exchangeId: number;
}

function parseTrades(occ: string, results: unknown[]): ParsedTrade[] {
  const out: ParsedTrade[] = [];
  for (const raw of results) {
    const row = raw as Record<string, unknown>;
    const sip = BigInt(String(row["sip_timestamp"] ?? row["participant_timestamp"] ?? 0));
    if (sip <= 0n) continue;
    const tsMs = nsToMs(sip);
    const price = Number(row["price"] ?? 0);
    const size = Number(row["size"] ?? 0);
    const conditions = Array.isArray(row["conditions"]) ? (row["conditions"] as number[]) : [];
    const ex = Number(row["exchange"] ?? 0);
    out.push({ tsMs, price, size, conditions, dedupId: tradeDedupId(occ, row), exchangeId: ex });
  }
  return out;
}

const fetchPaged = fetchPolygonPaged;

async function fetchQuotesWindowed(
  occ: string,
  apiKey: string,
  trades: ParsedTrade[],
  gteNs: bigint,
  lteNs: bigint,
  deadlineMs: number,
): Promise<{
  quotes: QuotePoint[];
  truncated: boolean;
  sawPolygonHttpError: boolean;
  lowestPolygonHttpStatus: number | null;
}> {
  if (trades.length === 0) {
    return { quotes: [], truncated: false, sawPolygonHttpError: false, lowestPolygonHttpStatus: null };
  }
  const all: QuotePoint[] = [];
  let truncated = false;
  let sawPolygonHttpError = false;
  let lowestPolygonHttpStatus: number | null = null;
  const sorted = [...trades].sort((a, b) => a.tsMs - b.tsMs);
  let winStart = sorted[0]!.tsMs - QUOTE_PREPAD_MS;
  let winEnd = winStart + QUOTE_WINDOW_MS;
  for (const t of sorted) {
    if (t.tsMs > winEnd) {
      const g = BigInt(Math.max(Number(gteNs), (winStart - QUOTE_PREPAD_MS) * 1_000_000));
      const l = BigInt(Math.min(Number(lteNs), winEnd * 1_000_000));
      const base = `${POLYGON_API}/v3/quotes/${encodeURIComponent(occ)}?timestamp.gte=${g}&timestamp.lte=${l}&order=asc&limit=${QUOTE_PAGE_LIMIT}`;
      const { rows, truncated: tr, sawPolygonHttpError: se, lowestPolygonHttpStatus: ls } = await fetchPaged(
        base,
        apiKey,
        deadlineMs,
      );
      if (tr) truncated = true;
      if (se) sawPolygonHttpError = true;
      if (ls != null && (lowestPolygonHttpStatus === null || ls < lowestPolygonHttpStatus)) lowestPolygonHttpStatus = ls;
      all.push(...parseQuotes(rows));
      winStart = t.tsMs - QUOTE_PREPAD_MS;
      winEnd = winStart + QUOTE_WINDOW_MS;
      if (Date.now() >= deadlineMs) {
        truncated = true;
        break;
      }
    }
  }
  {
    const g = BigInt(Math.max(Number(gteNs), (winStart - QUOTE_PREPAD_MS) * 1_000_000));
    const base = `${POLYGON_API}/v3/quotes/${encodeURIComponent(occ)}?timestamp.gte=${g}&timestamp.lte=${lteNs}&order=asc&limit=${QUOTE_PAGE_LIMIT}`;
    const { rows, truncated: tr, sawPolygonHttpError: se, lowestPolygonHttpStatus: ls } = await fetchPaged(
      base,
      apiKey,
      deadlineMs,
    );
    if (tr) truncated = true;
    if (se) sawPolygonHttpError = true;
    if (ls != null && (lowestPolygonHttpStatus === null || ls < lowestPolygonHttpStatus)) lowestPolygonHttpStatus = ls;
    all.push(...parseQuotes(rows));
  }
  all.sort((a, b) => a.tsMs - b.tsMs);
  const dedup: QuotePoint[] = [];
  for (const q of all) {
    const prev = dedup[dedup.length - 1];
    if (prev && prev.tsMs === q.tsMs && prev.bid === q.bid && prev.ask === q.ask) continue;
    dedup.push(q);
  }
  return { quotes: dedup, truncated, sawPolygonHttpError, lowestPolygonHttpStatus };
}

function parseOccMeta(occ: string): { expiration: string; strike: number; optionType: "call" | "put" } | null {
  const m = occ.match(/^O:([A-Z0-9.]+)(\d{6})([CP])(\d{8})$/);
  if (!m) return null;
  const [, , yymmdd, cp, strikeRaw] = m;
  const yy = 2000 + Number(yymmdd.slice(0, 2));
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  const expiration = `${yy}-${mm}-${dd}`;
  const strike = Number(strikeRaw) / 1000;
  const optionType = cp === "C" ? "call" : "put";
  return { expiration, strike, optionType };
}

export async function runStrategistTapeBackfill(args: {
  ticker: string;
  chain: ChainLike[];
  chainSummary: ChainSummaryLike;
  /** When set (e.g. from Schwab quote context), used for tiered OCC sampling. */
  marketCapTier?: MarketCapTier | string;
  budgetMs?: number;
  /** When set, use this NY session calendar date instead of lastCompletedTradingDayNy (flow capture REST segments). */
  forcedSessionDate?: string;
}): Promise<TapeBackfillStatus> {
  const ticker = args.ticker.toUpperCase();
  const budgetMs = args.budgetMs ?? DEFAULT_BUDGET_MS;
  const phase1Ms = Math.min(PHASE_1_BUDGET_MS, Math.max(1, Math.floor(budgetMs / 2)));
  const phase2Ms = Math.min(PHASE_2_BUDGET_MS, Math.max(1, budgetMs - phase1Ms));
  const nowWall = new Date();
  const todayYmd = nyCalendarYmd(nowWall);
  const sessionDate =
    typeof args.forcedSessionDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args.forcedSessionDate)
      ? args.forcedSessionDate
      : await lastCompletedTradingDayNy(nowWall);
  const { openMs, closeMs } = await rthBoundsMs(sessionDate);
  const nowMs = nowWall.getTime();
  const isSessionForToday = sessionDate === todayYmd;
  const { openMs: todayOpenMs } = await rthBoundsMs(todayYmd);
  let endMs: number;
  if (!isSessionForToday) {
    endMs = closeMs;
  } else {
    endMs = Math.min(nowMs, closeMs);
  }
  const coverageEndMs = endMs;
  const sessionInProgress = isSessionForToday && nowMs >= todayOpenMs && nowMs < closeMs;

  logger.info(
    {
      ticker,
      sessionDate,
      todayYmd,
      isSessionForToday,
      sessionInProgress,
      queryOpenMs: openMs,
      queryCloseMs: closeMs,
      coverageEndMs,
    },
    "strategistTapeBackfill: session window (last completed RTH session)",
  );

  const apiKey = process.env["POLYGON_API_KEY"];
  if (!apiKey) {
    return {
      status: "skipped",
      reason: "no_api_key",
      tapeBackfillReason: "skipped_no_api_key",
      sessionDate,
      coverageEndMs,
      occRequested: 0,
      occListLength: 0,
      occCompleted: 0,
      tradesInserted: 0,
      totalTradesFromPolygon: 0,
      persistRejectedCount: 0,
      anyTruncated: false,
      anySawPolygonHttpError: false,
      todayYmd,
      isSessionForToday,
      sessionInProgress,
      queryOpenMs: openMs,
      queryCloseMs: closeMs,
      tapeBackfillDedupeDrops: { totalDropped: 0, byOcc: {} },
    };
  }

  if (isSessionForToday && nowMs < todayOpenMs) {
    logger.info(
      { ticker, sessionDate, todayYmd, nowMs, todayOpenMs },
      "strategistTapeBackfill: before today's session open, skipping tape backfill",
    );
    return {
      status: "skipped",
      reason: "outside_rth",
      tapeBackfillReason: "skipped_outside_rth",
      sessionDate,
      coverageEndMs,
      occRequested: 0,
      occListLength: 0,
      occCompleted: 0,
      tradesInserted: 0,
      totalTradesFromPolygon: 0,
      persistRejectedCount: 0,
      anyTruncated: false,
      anySawPolygonHttpError: false,
      todayYmd,
      isSessionForToday,
      sessionInProgress,
      queryOpenMs: openMs,
      queryCloseMs: closeMs,
      tapeBackfillDedupeDrops: { totalDropped: 0, byOcc: {} },
    };
  }

  const schwabSnap = await fetchSchwabMarketSnapshot(ticker);
  const marketCtx = buildMarketContextSnapshot({
    ticker,
    marketCapUsd: schwabSnap?.marketCapUsd ?? null,
    assetType: schwabSnap?.assetType ?? null,
  });
  const tier = args.marketCapTier ?? marketCtx.tier;
  const { occs: occList, coverageGeometry } = buildTapeOccList(ticker, args.chain, args.chainSummary, tier);
  if (occList.length === 0) {
    return {
      status: "skipped",
      reason: "no_contracts",
      tapeBackfillReason: "skipped_other",
      sessionDate,
      coverageEndMs,
      occRequested: 0,
      occListLength: 0,
      occCompleted: 0,
      tradesInserted: 0,
      coverageGeometry,
      totalTradesFromPolygon: 0,
      persistRejectedCount: 0,
      anyTruncated: false,
      anySawPolygonHttpError: false,
      todayYmd,
      isSessionForToday,
      sessionInProgress,
      queryOpenMs: openMs,
      queryCloseMs: closeMs,
      tapeBackfillDedupeDrops: { totalDropped: 0, byOcc: {} },
    };
  }
  const startMs = openMs;
  const gteNs = BigInt(startMs) * 1_000_000n;
  const lteNs = BigInt(endMs) * 1_000_000n;

  const existingRowCountResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(optionsFlowRawTradesTable)
    .where(
      and(
        eq(optionsFlowRawTradesTable.underlyingSymbol, ticker),
        eq(optionsFlowRawTradesTable.date, sessionDate),
      ),
    );
  const existingRowCount = Number(existingRowCountResult[0]?.count ?? 0);

  interface OccPhase1Result {
    occ: string;
    kind: "completed" | "skipped_budget" | "skipped_bad_occ";
    parsed: ParsedTrade[];
    tradesInserted: number;
    insertedNullSideCount: number;
    totalTradesFromPolygon: number;
    persistRejectedCount: number;
    anyTruncated: boolean;
    anyError: boolean;
    anySawPolygonHttpError: boolean;
    dedupeDroppedForOcc: number;
  }

  interface OccPhase2Result {
    occ: string;
    kind: "completed" | "skipped_budget" | "skipped_bad_occ";
    rowsSideUpdated: number;
    remainingNullSide: number;
    anyTruncated: boolean;
    anyError: boolean;
    anySawPolygonHttpError: boolean;
  }

  const limit = pLimit(CONCURRENCY);
  const phase1Deadline = Date.now() + phase1Ms;

  const processOccPhase1 = async (occIdx: number, occ: string): Promise<OccPhase1Result> => {
    const budgetSkip = (): OccPhase1Result => ({
      occ,
      kind: "skipped_budget",
      parsed: [],
      tradesInserted: 0,
      insertedNullSideCount: 0,
      totalTradesFromPolygon: 0,
      persistRejectedCount: 0,
      anyTruncated: false,
      anyError: false,
      anySawPolygonHttpError: false,
      dedupeDroppedForOcc: 0,
    });

    if (Date.now() >= phase1Deadline) {
      return budgetSkip();
    }

    const meta = parseOccMeta(occ);
    if (!meta) {
      return {
        occ,
        kind: "skipped_bad_occ",
        parsed: [],
        tradesInserted: 0,
        insertedNullSideCount: 0,
        totalTradesFromPolygon: 0,
        persistRejectedCount: 0,
        anyTruncated: false,
        anyError: true,
        anySawPolygonHttpError: false,
        dedupeDroppedForOcc: 0,
      };
    }

    const budgetLeft = phase1Deadline - Date.now();
    const remainingRoots = occList.length - occIdx;
    const fairSlice = Math.floor(budgetLeft / Math.max(1, remainingRoots));
    const rootBudget = Math.min(PER_ROOT_MAX_MS, Math.max(PER_ROOT_MIN_MS, fairSlice));
    const occDeadline = Math.min(phase1Deadline, Date.now() + Math.min(rootBudget, budgetLeft));

    let baselineAvgVol: number | null = null;
    try {
      const bl = await getContract20dBaseline(occ, { referenceDate: new Date(`${sessionDate}T12:00:00Z`) });
      baselineAvgVol = bl?.avgVolume ?? null;
      if (bl && bl.avgVolume > 0) {
        await upsertStrikeVolumeBaselineFromContractBaseline({
          ticker,
          baselineDate: sessionDate,
          optionSymbol: occ,
          avgVolume20d: bl.avgVolume,
          daysObserved: bl.daysObserved,
        });
      }
    } catch (err) {
      logFlowPipelineWarn(
        "tape_backfill_baseline",
        "strategistTapeBackfill: contract baseline fetch failed",
        { err, occ, ticker },
      );
    }
    const oiSnapshot = openInterestForOcc(args.chain, meta);

    const tradeUrl = `${POLYGON_API}/v3/trades/${encodeURIComponent(occ)}?timestamp.gte=${gteNs}&timestamp.lte=${lteNs}&order=asc&limit=${TRADE_PAGE_LIMIT}`;
    const {
      rows: tradeRows,
      truncated: trTr,
      sawPolygonHttpError: trErr,
    } = await fetchPaged(tradeUrl, apiKey, occDeadline);
    const occSawHttp = trErr;
    const parsed = parseTrades(occ, tradeRows);
    const occTotalPoly = parsed.length;
    parsed.sort((a, b) => a.tsMs - b.tsMs);

    const occLegWindow = new FlowLegWindow();
    const rowsToInsert: Array<typeof optionsFlowRawTradesTable.$inferInsert> = [];
    let occPersistRejected = 0;
    for (const t of parsed) {
      const cl = classifyForFlowPersistence({
        price: t.price,
        size: t.size,
        conditions: t.conditions,
        nbbo: null,
        largeNotionalThresholdUsd: marketCtx.largeNotionalThresholdUsd,
        avgDailyContractVolume20d: baselineAvgVol,
        openInterest: oiSnapshot > 0 ? oiSnapshot : null,
      });
      if (!shouldPersistBackfillRow(cl)) {
        occPersistRejected++;
        continue;
      }
      const dteDays = dteCalendarDays(meta.expiration, t.tsMs);
      const sessionPhase = sessionPhaseFromTradeMs(t.tsMs);
      const venueClass = venueClassFromExchangeId(t.exchangeId);
      const sample = {
        tsMs: t.tsMs,
        occ,
        strike: meta.strike,
        expiration: meta.expiration,
        side: null,
        size: t.size,
        notional: cl.notional,
      };
      const ml = occLegWindow.annotate(ticker, sample);
      occLegWindow.record(ticker, sample);
      rowsToInsert.push({
        underlyingSymbol: ticker,
        date: sessionDate,
        timestamp: new Date(t.tsMs),
        optionSymbol: occ,
        optionType: meta.optionType,
        strike: meta.strike,
        expiration: meta.expiration,
        tradePrice: t.price,
        size: t.size,
        notional: cl.notional,
        side: null,
        isBlock: cl.isBlockForDb,
        isSweep: cl.isSweep,
        sourceTradeId: t.dedupId,
        exchangeId: t.exchangeId,
        venueClass,
        dteDays,
        sessionPhase,
        volOiRatio: cl.volOiRatio,
        openInterestSnapshot: oiSnapshot > 0 ? oiSnapshot : null,
        volumeVsBaseline20d: cl.volumeVsBaseline20d,
        marketCapUsd: marketCtx.marketCapUsd,
        marketCapTier: marketCtx.tier,
        notionalThresholdUsd: marketCtx.largeNotionalThresholdUsd,
        aggressorConfidence: "unknown",
        syntheticLegGroupId: ml.syntheticLegGroupId,
        multiLegConfidence: ml.multiLegConfidence,
        extras: ml.extras,
      });
    }

    let occTradesInserted = 0;
    let occInsertedNullSide = 0;
    let occDedupeDropped = 0;
    let occDbError = false;

    try {
      await db.transaction(async (tx) => {
        if (rowsToInsert.length > 0) {
          let occInserted = 0;
          for (let i = 0; i < rowsToInsert.length; i += OPTIONS_FLOW_RAW_TRADES_INSERT_MAX_ROWS) {
            const slice = rowsToInsert.slice(i, i + OPTIONS_FLOW_RAW_TRADES_INSERT_MAX_ROWS);
            const ins = await tx
              .insert(optionsFlowRawTradesTable)
              .values(slice)
              .onConflictDoNothing(OPTIONS_FLOW_RAW_TRADES_ON_CONFLICT_SOURCE_DEDUPE)
              .returning({
                id: optionsFlowRawTradesTable.id,
                side: optionsFlowRawTradesTable.side,
              });
            occTradesInserted += ins.length;
            occInserted += ins.length;
            for (const row of ins) {
              if (row.side == null) occInsertedNullSide++;
            }
          }
          occDedupeDropped = rowsToInsert.length - occInserted;
        }
        await tx
          .insert(optionsTapeBackfillOccCacheTable)
          .values({
            ticker,
            sessionDate,
            occ,
            lastCoverageEndNs: lteNs,
          })
          .onConflictDoUpdate({
            target: [
              optionsTapeBackfillOccCacheTable.ticker,
              optionsTapeBackfillOccCacheTable.sessionDate,
              optionsTapeBackfillOccCacheTable.occ,
            ],
            set: { lastCoverageEndNs: lteNs, updatedAt: new Date() },
          });
      });
    } catch (err) {
      const pgCtx = extractPgErrorContext(err);
      logFlowPipelineWarn(
        "tape_backfill_occ_commit",
        "strategistTapeBackfill: per-OCC insert/cache transaction failed",
        {
          err,
          occ,
          ticker,
          rowCount: rowsToInsert.length,
          message: pgCtx.message,
          code: pgCtx.code,
          detail: pgCtx.detail,
          constraint: pgCtx.constraint,
          ...(pgCtx.pgMessage !== undefined && pgCtx.pgMessage !== pgCtx.message
            ? { pgMessage: pgCtx.pgMessage }
            : {}),
        },
      );
      occDbError = true;
    }

    return {
      occ,
      kind: "completed",
      parsed,
      tradesInserted: occTradesInserted,
      insertedNullSideCount: occInsertedNullSide,
      totalTradesFromPolygon: occTotalPoly,
      persistRejectedCount: occPersistRejected,
      anyTruncated: trTr,
      anyError: occDbError,
      anySawPolygonHttpError: occSawHttp,
      dedupeDroppedForOcc: occDedupeDropped,
    };
  };

  const phase1Results = await Promise.all(
    occList.map((occ, occIdx) => limit(() => processOccPhase1(occIdx, occ))),
  );

  let phase1AnyTruncated = false;
  let phase1AnyError = false;
  let phase1AnySawPolygonHttpError = false;
  let tradesInserted = 0;
  let insertedNullSideThisRun = 0;
  let totalTradesFromPolygon = 0;
  let persistRejectedCount = 0;
  const dedupeByOcc = new Map<string, number>();
  let phase1CompletedCount = 0;

  for (const r of phase1Results) {
    if (r.kind === "skipped_budget") {
      phase1AnyTruncated = true;
    }
    if (r.kind === "skipped_bad_occ") {
      phase1AnyError = true;
    }
    if (r.kind === "completed") {
      phase1CompletedCount += 1;
    }
    tradesInserted += r.tradesInserted;
    insertedNullSideThisRun += r.insertedNullSideCount;
    totalTradesFromPolygon += r.totalTradesFromPolygon;
    persistRejectedCount += r.persistRejectedCount;
    if (r.anyTruncated) phase1AnyTruncated = true;
    if (r.anyError) phase1AnyError = true;
    if (r.anySawPolygonHttpError) phase1AnySawPolygonHttpError = true;
    if (r.dedupeDroppedForOcc > 0) {
      dedupeByOcc.set(r.occ, (dedupeByOcc.get(r.occ) ?? 0) + r.dedupeDroppedForOcc);
    }
  }

  const phase1FailedGlobally = occList.length > 0 && phase1CompletedCount === 0;

  const phase2Deadline = Date.now() + phase2Ms;

  const processOccPhase2 = async (occIdx: number, p1: OccPhase1Result): Promise<OccPhase2Result> => {
    if (phase1FailedGlobally) {
      return {
        occ: p1.occ,
        kind: "completed",
        rowsSideUpdated: 0,
        remainingNullSide: 0,
        anyTruncated: false,
        anyError: false,
        anySawPolygonHttpError: false,
      };
    }
    const occ = p1.occ;
    const budgetSkip = (): OccPhase2Result => ({
      occ,
      kind: "skipped_budget",
      rowsSideUpdated: 0,
      remainingNullSide: 0,
      anyTruncated: false,
      anyError: false,
      anySawPolygonHttpError: false,
    });

    if (p1.kind !== "completed") {
      return {
        occ,
        kind: "completed",
        rowsSideUpdated: 0,
        remainingNullSide: 0,
        anyTruncated: false,
        anyError: false,
        anySawPolygonHttpError: false,
      };
    }

    if (p1.parsed.length === 0) {
      return {
        occ,
        kind: "completed",
        rowsSideUpdated: 0,
        remainingNullSide: 0,
        anyTruncated: false,
        anyError: false,
        anySawPolygonHttpError: false,
      };
    }

    if (Date.now() >= phase2Deadline) {
      return budgetSkip();
    }

    const meta = parseOccMeta(occ);
    if (!meta) {
      return {
        occ,
        kind: "skipped_bad_occ",
        rowsSideUpdated: 0,
        remainingNullSide: 0,
        anyTruncated: false,
        anyError: true,
        anySawPolygonHttpError: false,
      };
    }

    const budgetLeft = phase2Deadline - Date.now();
    const remainingRoots = occList.length - occIdx;
    const fairSlice = Math.floor(budgetLeft / Math.max(1, remainingRoots));
    const rootBudget = Math.min(PER_ROOT_MAX_MS, Math.max(PER_ROOT_MIN_MS, fairSlice));
    const occDeadline = Math.min(phase2Deadline, Date.now() + Math.min(rootBudget, budgetLeft));

    let baselineAvgVol: number | null = null;
    try {
      const bl = await getContract20dBaseline(occ, { referenceDate: new Date(`${sessionDate}T12:00:00Z`) });
      baselineAvgVol = bl?.avgVolume ?? null;
    } catch {
      /* ignore */
    }
    const oiSnapshot = openInterestForOcc(args.chain, meta);

    const {
      quotes,
      truncated: trQ,
      sawPolygonHttpError: qErr,
    } = await fetchQuotesWindowed(occ, apiKey, p1.parsed, gteNs, lteNs, occDeadline);

    const occLegWindow = new FlowLegWindow();
    let rowsSideUpdated = 0;
    let remainingNullSide = 0;
    let occDbError = false;

    try {
      await db.transaction(async (tx) => {
        for (const t of p1.parsed) {
          const nb = nbboAtOrBefore(quotes, t.tsMs);
          const cl = classifyForFlowPersistence({
            price: t.price,
            size: t.size,
            conditions: t.conditions,
            nbbo: nb,
            largeNotionalThresholdUsd: marketCtx.largeNotionalThresholdUsd,
            avgDailyContractVolume20d: baselineAvgVol,
            openInterest: oiSnapshot > 0 ? oiSnapshot : null,
          });
          if (!shouldPersistBackfillRow(cl)) {
            continue;
          }
          const dteDays = dteCalendarDays(meta.expiration, t.tsMs);
          const sessionPhase = sessionPhaseFromTradeMs(t.tsMs);
          const venueClass = venueClassFromExchangeId(t.exchangeId);
          const sample = {
            tsMs: t.tsMs,
            occ,
            strike: meta.strike,
            expiration: meta.expiration,
            side: cl.side,
            size: t.size,
            notional: cl.notional,
          };
          const ml = occLegWindow.annotate(ticker, sample);
          occLegWindow.record(ticker, sample);

          const upd = await tx
            .update(optionsFlowRawTradesTable)
            .set({
              side: cl.side,
              isBlock: cl.isBlockForDb,
              isSweep: cl.isSweep,
              notional: cl.notional,
              volOiRatio: cl.volOiRatio,
              volumeVsBaseline20d: cl.volumeVsBaseline20d,
              aggressorConfidence: cl.aggressorConfidence,
              syntheticLegGroupId: ml.syntheticLegGroupId,
              multiLegConfidence: ml.multiLegConfidence,
              extras: ml.extras,
              dteDays,
              sessionPhase,
              venueClass,
            })
            .where(
              and(
                eq(optionsFlowRawTradesTable.underlyingSymbol, ticker),
                eq(optionsFlowRawTradesTable.date, sessionDate),
                eq(optionsFlowRawTradesTable.optionSymbol, occ),
                eq(optionsFlowRawTradesTable.sourceTradeId, t.dedupId),
                isNull(optionsFlowRawTradesTable.side),
              ),
            )
            .returning({ id: optionsFlowRawTradesTable.id, side: optionsFlowRawTradesTable.side });

          for (const row of upd) {
            rowsSideUpdated += 1;
            if (row.side == null) remainingNullSide += 1;
          }
        }
      });
    } catch (err) {
      const pgCtx = extractPgErrorContext(err);
      logFlowPipelineWarn(
        "tape_backfill_phase2",
        "strategistTapeBackfill: phase-2 per-OCC update transaction failed",
        {
          err,
          occ,
          ticker,
          message: pgCtx.message,
          code: pgCtx.code,
        },
      );
      occDbError = true;
    }

    return {
      occ,
      kind: "completed",
      rowsSideUpdated,
      remainingNullSide,
      anyTruncated: trQ,
      anyError: occDbError,
      anySawPolygonHttpError: qErr,
    };
  };

  const phase2Results = await Promise.all(
    phase1Results.map((p1, occIdx) => limit(() => processOccPhase2(occIdx, p1))),
  );

  let occCompleted = 0;
  let phase2AnyTruncated = false;
  let phase2AnyError = false;
  let phase2AnySawPolygonHttpError = false;

  for (const r of phase2Results) {
    if (r.kind === "completed") {
      occCompleted += 1;
    }
    if (r.kind === "skipped_budget") {
      phase2AnyTruncated = true;
    }
    if (r.anyTruncated) phase2AnyTruncated = true;
    if (r.anyError) phase2AnyError = true;
    if (r.anySawPolygonHttpError) phase2AnySawPolygonHttpError = true;
  }

  let anyTruncated = phase1AnyTruncated || phase2AnyTruncated;
  let anyError = phase1AnyError || phase2AnyError;
  const anySawPolygonHttpError = phase1AnySawPolygonHttpError || phase2AnySawPolygonHttpError;

  const nullSideAfterPhase2Result = await db
    .select({ c: sql<number>`count(*)` })
    .from(optionsFlowRawTradesTable)
    .where(
      and(
        eq(optionsFlowRawTradesTable.underlyingSymbol, ticker),
        eq(optionsFlowRawTradesTable.date, sessionDate),
        isNull(optionsFlowRawTradesTable.side),
      ),
    );
  const stillNullSideAfterPhase2 = Number(nullSideAfterPhase2Result[0]?.c ?? 0);

  await flushFlowPersistenceNow();
  try {
    await runRollupOnceForSymbol(ticker, sessionDate);
  } catch (err) {
    logFlowPipelineWarn(
      "tape_backfill_symbol_rollup",
      "strategistTapeBackfill: symbol rollup failed",
      { err, ticker },
    );
    anyError = true;
  }

  let status: TapeBackfillStatusValue = "complete";
  if (phase1FailedGlobally) status = "failed";
  else if (occCompleted < occList.length || phase2AnyTruncated) status = "partial";
  else if (anyError) status = "partial";

  let tapeBackfillReason: TapeBackfillDiagnosticReason;
  if (anySawPolygonHttpError) {
    tapeBackfillReason = "polygon_error";
  } else if (
    tradesInserted === 0 &&
    totalTradesFromPolygon > 0 &&
    persistRejectedCount >= totalTradesFromPolygon
  ) {
    tapeBackfillReason = "empty_after_filter";
  } else if (
    tradesInserted > 0 &&
    (anyTruncated || status !== "complete" || occCompleted < occList.length)
  ) {
    tapeBackfillReason = "live_partial";
  } else if (tradesInserted > 0) {
    tapeBackfillReason = "live_complete";
  } else if (
    tradesInserted === 0 &&
    totalTradesFromPolygon === 0 &&
    !anyTruncated &&
    !anyError &&
    occCompleted === occList.length
  ) {
    tapeBackfillReason = "empty_polygon_response";
  } else if (tradesInserted === 0 && existingRowCount === 0 && anyTruncated === true) {
    tapeBackfillReason = "timeout_no_inserts";
  } else {
    tapeBackfillReason = "skipped_other";
  }

  if (tradesInserted === 0 && existingRowCount > 0) {
    tapeBackfillReason = "already_persisted";
    status = "complete";
  }

  let totalDedupeDropped = 0;
  const dedupeByOccRecord: Record<string, number> = {};
  for (const [o, c] of dedupeByOcc) {
    dedupeByOccRecord[o] = c;
    totalDedupeDropped += c;
  }
  const tapeBackfillDedupeDrops: TapeBackfillDedupeDrops = {
    totalDropped: totalDedupeDropped,
    byOcc: dedupeByOccRecord,
  };

  if (anyTruncated || stillNullSideAfterPhase2 > 0) {
    queueMicrotask(() => {
      void reclassifyUnclassifiedTrades(ticker).catch((err: unknown) => {
        logger.error({ err, ticker }, "optionsTradeReclassifier: failed");
      });
    });
  }

  if (totalDedupeDropped > 0) {
    const tapeBackfillDedupeTopOccs = Object.entries(dedupeByOccRecord)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([occ, dropped]) => ({ occ, dropped }));
    logger.info(
      {
        ticker,
        tapeBackfillDedupeDropsTotal: totalDedupeDropped,
        tapeBackfillDedupeTopOccs,
      },
      "strategistTapeBackfill: dedupe drops summary",
    );
  }

  logger.info(
    {
      ticker,
      tapeBackfillReason,
      status,
      reason: anyTruncated ? "timeout_or_pagination" : anyError ? "insert_or_rollups" : null,
      occRequested: occList.length,
      occCompleted,
      tradesInserted,
      totalTradesFromPolygon,
      persistRejectedCount,
      anyTruncated,
      anySawPolygonHttpError,
      sessionDate,
      queryOpenMs: openMs,
      queryCloseMs: closeMs,
    },
    "strategistTapeBackfill: done",
  );

  return {
    status,
    reason: anyTruncated ? "timeout_or_pagination" : anyError ? "insert_or_rollups" : null,
    tapeBackfillReason,
    sessionDate,
    coverageEndMs,
    occRequested: occList.length,
    occListLength: occList.length,
    occCompleted,
    tradesInserted,
    totalTradesFromPolygon,
    persistRejectedCount,
    anyTruncated,
    anyError,
    coverageGeometry,
    anySawPolygonHttpError,
    todayYmd,
    isSessionForToday,
    sessionInProgress,
    queryOpenMs: openMs,
    queryCloseMs: closeMs,
    tapeBackfillDedupeDrops,
  };
}
