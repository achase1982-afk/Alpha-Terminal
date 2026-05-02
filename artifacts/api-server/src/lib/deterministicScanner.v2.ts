import { checkEventConflicts } from "./calendarEventChecker.js";
import { getNextEarningsDate } from "./earningsService.js";
import { emitTelemetry, createTelemetryBatch } from "./telemetryStore.js";
import type { FilterResult, ScanResult, ScanCandidate } from "./deterministicScanner.js";
import { db, equityDailyTable, flowDailyAggregatesTable, optionsFlowPerStrikeTable, scannerTelemetryTable } from "@workspace/db";
import { desc, eq, inArray, and, gte, lte, sql } from "drizzle-orm";
import type { InferInsertModel } from "drizzle-orm";
import { getSettings, type StrategistConfig } from "./strategistSettings.js";
import { getCachedRegime, buildFallbackRegime, type StructuredRegime } from "./regimePostProcessor.js";
import { computeIOScore } from "./ioScoreEngine.js";
import { requestFlowCapture } from "./flowCaptureService.js";
import { getFlowAcceleration, flowAccelerationPoints, computeLiveFlowBucket } from "./optionsBaselines.js";
import { getLiveSessionStats, setWatchlist as setWatcherWatchlist, getCoverageInfo, isWatcherEnabled, type CoverageInfo } from "./optionsWatcher.js";
import { logger } from "./logger.js";

const SCHWAB_API = "https://api.schwabapi.com/marketdata/v1";
const SCHWAB_TRADER = "https://api.schwabapi.com/trader/v1";

// ─── Config (all thresholds stored here, not hardcoded inline) ───────────────
const CFG = {
  minScore: 55,
  minPrice: 10,
  minAvgVol: 500_000,
  minMarketCap: 2e9,
  ipoMinDays: 60,
  splitExcludeDays: 10,
  liquidityGateMinScore: 8,
  earningsSuppressDays: 14,
  ivrLookbackDays: 5,       // tunable to 3 or 10 after backtesting
  flowDteMax: 60,
  flowStrikePct: 0.20,      // ±20% of spot
  liqStrikePct: 0.10,       // ±10% of spot for liquidity gate
  liqDteMin: 20,
  liqDteMax: 60,
  blockMinContracts: 500,
  blockNotionalPct: 0.005,  // 0.5% of total notional
  blockOiMin: 200,
  obvFlatThreshold: 0.05,
  rsFlatThreshold: 0.001,
  maxScanConcurrency: 5,
  /** Top symbols to run on-demand flow capture before Polygon highlights (WebSocket budget). */
  flowCaptureTopN: Math.min(
    50,
    Math.max(
      0,
      (() => {
        const raw = process.env["SCANNER_TOP_N_FLOW_CAPTURE"]?.trim();
        if (raw === undefined || raw === "") return 20;
        const n = Number(raw);
        return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 20;
      })(),
    ),
  ),
  flowCaptureConcurrency: 5,
};

// ─── Sector ETF mapping ────────────────────────────────────────────────────
const SECTOR_TO_ETF: Record<string, string> = {
  "Technology": "XLK",
  "Financials": "XLF",
  "Energy": "XLE",
  "Healthcare": "XLV",
  "Industrials": "XLI",
  "Communication Services": "XLC",
  "Consumer Discretionary": "XLY",
  "Consumer Staples": "XLP",
  "Utilities": "XLU",
  "Real Estate": "XLRE",
  "Materials": "XLB",
};

const SECTOR_MAP: Record<string, string> = {
  AAPL:"Technology",MSFT:"Technology",NVDA:"Technology",AMZN:"Consumer Discretionary",META:"Technology",
  GOOGL:"Technology",GOOG:"Technology",TSLA:"Consumer Discretionary",AVGO:"Technology",NFLX:"Communication Services",
  AMD:"Technology",CRM:"Technology",ORCL:"Technology",ADBE:"Technology",INTU:"Technology",
  NOW:"Technology",QCOM:"Technology",TXN:"Technology",AMAT:"Technology",MU:"Technology",
  LRCX:"Technology",PANW:"Technology",KLAC:"Technology",SNPS:"Technology",CDNS:"Technology",
  INTC:"Technology",HPQ:"Technology",DELL:"Technology",HPE:"Technology",CSCO:"Technology",
  JPM:"Financials",BAC:"Financials",WFC:"Financials",GS:"Financials",MS:"Financials",
  SCHW:"Financials",C:"Financials",BLK:"Financials",SPGI:"Financials",CME:"Financials",
  ICE:"Financials",MCO:"Financials",AXP:"Financials",V:"Financials",MA:"Financials",
  CB:"Financials",PGR:"Financials",TRV:"Financials",ALL:"Financials",MET:"Financials",
  UNH:"Healthcare",LLY:"Healthcare",ABBV:"Healthcare",MRK:"Healthcare",PFE:"Healthcare",
  JNJ:"Healthcare",ABT:"Healthcare",TMO:"Healthcare",ISRG:"Healthcare",SYK:"Healthcare",
  VRTX:"Healthcare",REGN:"Healthcare",AMGN:"Healthcare",BSX:"Healthcare",HCA:"Healthcare",
  DHR:"Healthcare",ZTS:"Healthcare",DXCM:"Healthcare",MDT:"Healthcare",ELV:"Healthcare",
  XOM:"Energy",CVX:"Energy",SLB:"Energy",FANG:"Energy",BKR:"Energy",COP:"Energy",EOG:"Energy",
  PG:"Consumer Staples",KO:"Consumer Staples",PEP:"Consumer Staples",COST:"Consumer Staples",
  WMT:"Consumer Staples",CL:"Consumer Staples",MDLZ:"Consumer Staples",PM:"Consumer Staples",
  MCD:"Consumer Discretionary",HD:"Consumer Discretionary",LOW:"Consumer Discretionary",
  TGT:"Consumer Discretionary",SBUX:"Consumer Discretionary",NKE:"Consumer Discretionary",
  DIS:"Communication Services",CMCSA:"Communication Services",VZ:"Communication Services",
  T:"Communication Services",TMUS:"Communication Services",
  NEE:"Utilities",DUK:"Utilities",SO:"Utilities",
  PLD:"Real Estate",AMT:"Real Estate",EQIX:"Real Estate",
  LIN:"Materials",SHW:"Materials",ECL:"Materials",
  CAT:"Industrials",HON:"Industrials",RTX:"Industrials",DE:"Industrials",GE:"Industrials",
  UPS:"Industrials",FDX:"Industrials",NSC:"Industrials",UNP:"Industrials",
};

function getSector(sym: string): string { return SECTOR_MAP[sym.toUpperCase()] ?? "Other"; }
function getSectorEtf(sym: string): string { return SECTOR_TO_ETF[getSector(sym)] ?? "SPY"; }

async function fetchIvrFromDB(symbols: string[]): Promise<{ currentIvr: Map<string, number>; ivrNdAgo: Map<string, number> }> {
  const currentIvr = new Map<string, number>();
  const ivrNdAgo = new Map<string, number>();
  if (symbols.length === 0) return { currentIvr, ivrNdAgo };

  const upperSymbols = symbols.map(s => s.toUpperCase());

  const rows = await db
    .select({
      symbol: equityDailyTable.symbol,
      date: equityDailyTable.date,
      ivr: equityDailyTable.ivr,
    })
    .from(equityDailyTable)
    .where(and(
      inArray(equityDailyTable.symbol, upperSymbols),
      sql`${equityDailyTable.ivr} IS NOT NULL`,
    ))
    .orderBy(equityDailyTable.symbol, desc(equityDailyTable.date));

  const bySymbol = new Map<string, Array<{ date: string; ivr: number }>>();
  for (const row of rows) {
    if (row.ivr == null || isNaN(row.ivr)) continue;
    const key = row.symbol.toUpperCase();
    if (!bySymbol.has(key)) bySymbol.set(key, []);
    bySymbol.get(key)!.push({ date: row.date, ivr: row.ivr });
  }

  for (const [sym, entries] of bySymbol) {
    if (entries.length > 0) currentIvr.set(sym, entries[0].ivr);
    const lookback = CFG.ivrLookbackDays;
    if (entries.length > lookback) {
      ivrNdAgo.set(sym, entries[lookback].ivr);
    } else if (entries.length >= 3) {
      ivrNdAgo.set(sym, entries[entries.length - 1].ivr);
    }
  }

  return { currentIvr, ivrNdAgo };
}

// ─── Math utilities ────────────────────────────────────────────────────────
interface Candle { close: number; volume: number; datetime?: number; }

function computeSMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const s = closes.slice(-period);
  return s.reduce((a, b) => a + b, 0) / period;
}

function computeATR(candles: Candle[], period: number): number | null {
  if (candles.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const hl = candles[i].close - candles[i - 1].close; // simplified ATR using close-to-close
    trs.push(Math.abs(hl));
  }
  if (trs.length < period) return null;
  return trs.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function computePercentChange(closes: number[], days: number): number | null {
  if (closes.length < days + 1) return null;
  const cur = closes[closes.length - 1];
  const old = closes[closes.length - 1 - days];
  if (old <= 0) return null;
  return ((cur - old) / old) * 100;
}

function computeHV20(closes: number[]): number {
  if (closes.length < 21) return 0;
  const slice = closes.slice(-21);
  const returns: number[] = [];
  for (let i = 1; i < slice.length; i++) {
    if (slice[i - 1] > 0) returns.push(Math.log(slice[i] / slice[i - 1]));
  }
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + Math.pow(r - mean, 2), 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

function computeOBV(candles: Candle[]): number[] {
  const obv: number[] = [0];
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[i - 1].close) obv.push(obv[i - 1] + candles[i].volume);
    else if (candles[i].close < candles[i - 1].close) obv.push(obv[i - 1] - candles[i].volume);
    else obv.push(obv[i - 1]);
  }
  return obv;
}

function linRegSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const x = Array.from({ length: n }, (_, i) => i);
  const mx = (n - 1) / 2;
  const my = values.reduce((a, b) => a + b, 0) / n;
  const num = x.reduce((acc, xi, i) => acc + (xi - mx) * (values[i] - my), 0);
  const den = x.reduce((acc, xi) => acc + Math.pow(xi - mx, 2), 0);
  return den === 0 ? 0 : num / den;
}

// ─── Data fetchers ─────────────────────────────────────────────────────────
async function fetchQuotesBatch(symbols: string[], token: string): Promise<Map<string, { lastPrice: number; totalVolume: number; netPercentChange: number; avgVol?: number }>> {
  const map = new Map<string, { lastPrice: number; totalVolume: number; netPercentChange: number; avgVol?: number }>();
  const chunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += 100) chunks.push(symbols.slice(i, i + 100));
  for (const chunk of chunks) {
    try {
      const url = `${SCHWAB_API}/quotes?symbols=${chunk.map(encodeURIComponent).join(",")}&fields=quote,fundamental`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) continue;
      const json = await res.json() as Record<string, unknown>;
      for (const [sym, raw] of Object.entries(json)) {
        const q = (raw as Record<string, unknown>)["quote"] as Record<string, unknown> | undefined;
        const f = (raw as Record<string, unknown>)["fundamental"] as Record<string, unknown> | undefined;
        if (!q) continue;
        map.set(sym.toUpperCase(), {
          lastPrice: (q["lastPrice"] ?? q["mark"] ?? 0) as number,
          totalVolume: (q["totalVolume"] ?? 0) as number,
          netPercentChange: (q["netPercentChange"] ?? 0) as number,
          avgVol: (f?.["avg10DaysVolume"] ?? f?.["avg1YearVolume"] ?? undefined) as number | undefined,
        });
      }
    } catch { /* skip */ }
  }
  return map;
}

async function fetchPriceHistory(sym: string, token: string): Promise<Candle[]> {
  try {
    const params = new URLSearchParams({ symbol: sym, periodType: "month", period: "3", frequencyType: "daily", frequency: "1", needExtendedHoursData: "false" });
    const res = await fetch(`${SCHWAB_API}/pricehistory?${params}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];
    const json = await res.json() as { candles?: Array<Record<string, unknown>> };
    return (json.candles ?? []).map(c => ({ close: c["close"] as number, volume: c["volume"] as number, datetime: c["datetime"] as number }));
  } catch { return []; }
}

async function fetchPortfolioSymbols(token: string): Promise<Set<string>> {
  try {
    const res = await fetch(`${SCHWAB_TRADER}/accounts?fields=positions`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return new Set();
    const json = await res.json() as Array<Record<string, unknown>>;
    const syms = new Set<string>();
    for (const acct of json) {
      const positions = ((acct["securitiesAccount"] as Record<string, unknown>)?.["positions"] ?? []) as Array<Record<string, unknown>>;
      for (const pos of positions) {
        const sym = ((pos["instrument"] as Record<string, unknown>)?.["symbol"] as string) ?? "";
        if (sym) syms.add(sym.toUpperCase());
      }
    }
    return syms;
  } catch { return new Set(); }
}

// ─── Flow/Liquidity types (used by both API and DB fetchers) ──────────────
interface FlowMetrics {
  callVolume: number;
  putVolume: number;
  weightedVolOiRatio: number;
  blockCount: number;
  totalNotional: number;
  dataAvailable: boolean;
}

interface LiqMetrics {
  avgSpreadPct: number;
  totalOI: number;
  score: number;
}

interface PolygonFlowResult {
  liq: LiqMetrics;
  flow: FlowMetrics;
  iv30d: number | null;
}

// ─── DB-backed data fetchers (T003 refactor) ──────────────────────────────

async function fetchEquityHistoryFromDB(symbols: string[]): Promise<Map<string, Candle[]>> {
  const map = new Map<string, Candle[]>();
  if (symbols.length === 0) return map;

  const rows = await db
    .select({
      symbol: equityDailyTable.symbol,
      date: equityDailyTable.date,
      close: equityDailyTable.close,
      volume: equityDailyTable.volume,
    })
    .from(equityDailyTable)
    .where(inArray(equityDailyTable.symbol, symbols))
    .orderBy(equityDailyTable.symbol, equityDailyTable.date);

  for (const row of rows) {
    if (!map.has(row.symbol)) map.set(row.symbol, []);
    map.get(row.symbol)!.push({
      close: row.close,
      volume: row.volume ?? 0,
      datetime: new Date(row.date).getTime(),
    });
  }
  return map;
}

interface DBFlowData {
  flow: FlowMetrics;
  strikes: Array<{ strike: number; dte: number | null; bid: number; ask: number; openInterest: number }>;
  totalOI: number;
  iv30d: number | null;
}

async function fetchFlowDataFromDB(symbols: string[]): Promise<Map<string, DBFlowData>> {
  const map = new Map<string, DBFlowData>();
  if (symbols.length === 0) return map;

  // Normalize to uppercase for the query — DB stores symbols uppercase.
  const symbolsUpper = symbols.map(s => s.toUpperCase());

  const perSymbolDates = await db
    .select({
      sym: flowDailyAggregatesTable.underlyingSymbol,
      maxDate: sql<string>`max(${flowDailyAggregatesTable.date})`,
    })
    .from(flowDailyAggregatesTable)
    .where(inArray(flowDailyAggregatesTable.underlyingSymbol, symbolsUpper))
    .groupBy(flowDailyAggregatesTable.underlyingSymbol);

  if (perSymbolDates.length === 0) return map;

  const symDatePairs = new Map<string, string>();
  const allDates = new Set<string>();
  for (const row of perSymbolDates) {
    if (row.maxDate) {
      symDatePairs.set(row.sym, row.maxDate);
      allDates.add(row.maxDate);
    }
  }
  if (symDatePairs.size === 0) return map;

  const symsWithDates = [...symDatePairs.keys()];

  const aggRows = await db
    .select()
    .from(flowDailyAggregatesTable)
    .where(and(
      inArray(flowDailyAggregatesTable.underlyingSymbol, symsWithDates),
      inArray(flowDailyAggregatesTable.date, [...allDates]),
    ));
  const filteredAggs = aggRows.filter(a => symDatePairs.get(a.underlyingSymbol) === a.date);

  const strikeRows = await db
    .select()
    .from(optionsFlowPerStrikeTable)
    .where(and(
      inArray(optionsFlowPerStrikeTable.underlyingSymbol, symsWithDates),
      inArray(optionsFlowPerStrikeTable.date, [...allDates]),
    ));
  const filteredStrikes = strikeRows.filter(s => symDatePairs.get(s.underlyingSymbol) === s.date);

  logger.info({
    requested: symbols.length,
    foundFlow: perSymbolDates.length,
    aggsLoaded: filteredAggs.length,
    strikesLoaded: filteredStrikes.length,
    sampleMaxDate: perSymbolDates[0]?.maxDate ?? null,
  }, "Scanner: flow data DB lookup");

  const strikesBySymbol = new Map<string, typeof filteredStrikes>();
  for (const s of filteredStrikes) {
    if (!strikesBySymbol.has(s.underlyingSymbol)) strikesBySymbol.set(s.underlyingSymbol, []);
    strikesBySymbol.get(s.underlyingSymbol)!.push(s);
  }

  const eqRows = await db
    .select({ symbol: equityDailyTable.symbol, iv30d: equityDailyTable.iv30d, date: equityDailyTable.date })
    .from(equityDailyTable)
    .where(and(
      inArray(equityDailyTable.symbol, symsWithDates),
      sql`${equityDailyTable.iv30d} IS NOT NULL AND ${equityDailyTable.iv30d} > 0`,
    ))
    .orderBy(equityDailyTable.symbol, desc(equityDailyTable.date));
  const iv30dMap = new Map<string, number | null>();
  for (const row of eqRows) {
    if (!iv30dMap.has(row.symbol)) iv30dMap.set(row.symbol, row.iv30d);
  }

  for (const agg of filteredAggs) {
    const sym = agg.underlyingSymbol;
    const rawStrikes = strikesBySymbol.get(sym) ?? [];

    const strikesOut = rawStrikes.map(s => ({
      strike: s.strike,
      dte: s.dte,
      bid: s.bid ?? 0,
      ask: s.ask ?? 0,
      openInterest: s.openInterest ?? 0,
    }));

    map.set(sym, {
      flow: {
        callVolume: agg.totalCallVolume ?? 0,
        putVolume: agg.totalPutVolume ?? 0,
        weightedVolOiRatio: agg.avgVolOiRatio ?? 0,
        blockCount: agg.blockCount ?? 0,
        totalNotional: agg.totalOptionsNotional ?? 0,
        dataAvailable: true,
      },
      strikes: strikesOut,
      totalOI: agg.totalOi ?? 0,
      iv30d: iv30dMap.get(sym) ?? null,
    });
  }

  return map;
}

function computeLiqFromStrikes(
  strikes: DBFlowData["strikes"],
  spot: number,
): LiqMetrics & { quoteDataAvailable: boolean } {
  const saneStrikes = strikes.filter(s => {
    if (s.bid <= 0 || s.ask <= 0) return true;
    if (s.ask > s.bid * 10) return false;
    if (s.ask > spot * 2) return false;
    return true;
  });

  const hasBidAsk = saneStrikes.some(s => s.bid > 0 && s.ask > 0);

  if (!hasBidAsk) {
    const totalOI = saneStrikes.reduce((sum, s) => sum + s.openInterest, 0);
    return { avgSpreadPct: 0, totalOI, score: 15, quoteDataAvailable: false };
  }

  const liqStrikes = saneStrikes.filter(s => {
    const inStrikeRange = s.strike >= spot * (1 - CFG.liqStrikePct) && s.strike <= spot * (1 + CFG.liqStrikePct);
    const inDteRange = (s.dte ?? 0) >= CFG.liqDteMin && (s.dte ?? 0) <= CFG.liqDteMax;
    return inStrikeRange && inDteRange && s.bid > 0 && s.ask > 0;
  });

  if (liqStrikes.length === 0) {
    const totalOI = saneStrikes.reduce((sum, s) => sum + s.openInterest, 0);
    return { avgSpreadPct: 0, totalOI, score: 15, quoteDataAvailable: false };
  }

  let avgSpreadPct = 99;
  let totalOI = 0;
  let liqScore = 0;

  const spreads: number[] = [];
  for (const s of liqStrikes) {
    const mid = (s.bid + s.ask) / 2;
    if (mid > 0) spreads.push(((s.ask - s.bid) / mid) * 100);
    totalOI += s.openInterest;
  }
  avgSpreadPct = spreads.length > 0 ? spreads.reduce((a, b) => a + b, 0) / spreads.length : 99;
  if (avgSpreadPct <= 5) liqScore = 15;
  else if (avgSpreadPct <= 10) liqScore = 12;
  else if (avgSpreadPct <= 20) liqScore = 9;
  else if (avgSpreadPct <= 35) liqScore = 6;

  if (liqScore < 8 && totalOI >= 5000) liqScore = 9;

  return { avgSpreadPct, totalOI, score: liqScore, quoteDataAvailable: true };
}

// ─── Polygon flow data for Category 4 (legacy — kept for fallback) ────────

async function fetchPolygonOptionsData(sym: string, apiKey: string, spot: number): Promise<PolygonFlowResult | null> {
  const today = new Date();
  const liqMin = new Date(today.getTime() + CFG.liqDteMin * 86_400_000).toISOString().slice(0, 10);
  const liqMax = new Date(today.getTime() + CFG.liqDteMax * 86_400_000).toISOString().slice(0, 10);
  const flowMax = new Date(today.getTime() + CFG.flowDteMax * 86_400_000).toISOString().slice(0, 10);

  const strikeFlowMin = Math.floor(spot * (1 - CFG.flowStrikePct));
  const strikeFlowMax = Math.ceil(spot * (1 + CFG.flowStrikePct));

  const params = new URLSearchParams({
    expiration_date_gte: today.toISOString().slice(0, 10),
    expiration_date_lte: flowMax,
    strike_price_gte: String(strikeFlowMin),
    strike_price_lte: String(strikeFlowMax),
    limit: "250",
    apiKey,
  });

  interface PolyResult {
    details?: { contract_type?: string; expiration_date?: string; strike_price?: number; ticker?: string };
    day?: { volume?: number };
    last_quote?: { bid?: number; ask?: number };
    open_interest?: number;
    implied_volatility?: number;
    greeks?: { delta?: number };
    underlying_asset?: { price?: number };
  }
  interface PolyPage { results?: PolyResult[]; status?: string; next_url?: string; }

  const allResults: PolyResult[] = [];
  let nextUrl: string | undefined = `https://api.polygon.io/v3/snapshot/options/${encodeURIComponent(sym)}?${params.toString()}`;
  let pages = 0;
  while (nextUrl && pages < 4) {
    const fetchUrl = pages > 0 ? `${nextUrl}&apiKey=${apiKey}` : nextUrl;
    try {
      const resp = await fetch(fetchUrl, { signal: AbortSignal.timeout(12_000) });
      if (!resp.ok) break;
      const json = await resp.json() as PolyPage;
      if (json.status !== "OK" || !json.results?.length) break;
      allResults.push(...json.results);
      nextUrl = json.next_url;
      pages++;
    } catch { break; }
  }

  if (allResults.length === 0) return null;

  // Compute expiration DTE for each contract
  const nowMs = Date.now();
  function dte(expDate: string): number {
    return Math.max(0, Math.round((new Date(`${expDate}T20:00:00Z`).getTime() - nowMs) / 86_400_000));
  }

  // ── Liquidity gate: strikes within 10% spot, 20-60 DTE ──
  const liqContracts = allResults.filter(r => {
    const sp = r.details?.strike_price ?? 0;
    const d = dte(r.details?.expiration_date ?? "");
    const inStrikeRange = sp >= spot * (1 - CFG.liqStrikePct) && sp <= spot * (1 + CFG.liqStrikePct);
    const inDteRange = d >= CFG.liqDteMin && d <= CFG.liqDteMax;
    return inStrikeRange && inDteRange && r.last_quote?.bid != null && r.last_quote?.ask != null;
  });

  let liqScore = 0;
  let avgSpreadPct = 99;
  let totalOI = 0;

  if (liqContracts.length > 0) {
    const spreads: number[] = [];
    for (const r of liqContracts) {
      const bid = r.last_quote?.bid ?? 0;
      const ask = r.last_quote?.ask ?? 0;
      const mid = (bid + ask) / 2;
      if (mid > 0) spreads.push(((ask - bid) / mid) * 100);
      totalOI += r.open_interest ?? 0;
    }
    avgSpreadPct = spreads.length > 0 ? spreads.reduce((a, b) => a + b, 0) / spreads.length : 99;

    if (avgSpreadPct <= 2) liqScore = 15;
    else if (avgSpreadPct <= 5) liqScore = 12;
    else if (avgSpreadPct <= 10) liqScore = 9;
    else if (avgSpreadPct <= 15) liqScore = 6;
    else liqScore = 0;
  }

  // ── Flow divergence: strikes within 20% spot, 1-60 DTE ──
  let callVolume = 0;
  let putVolume = 0;
  let totalNotional = 0;
  let weightedVolOiNum = 0;
  let weightedVolOiDen = 0;
  let blockCount = 0;
  const blockCandidates: Array<{ vol: number; notional: number }> = [];

  for (const r of allResults) {
    const vol = r.day?.volume ?? 0;
    const bid = r.last_quote?.bid ?? 0;
    const ask = r.last_quote?.ask ?? 0;
    const mid = (bid + ask) / 2;
    const oi = r.open_interest ?? 0;
    const notional = vol * mid * 100;
    const ct = r.details?.contract_type;

    if (ct === "call") callVolume += vol;
    else if (ct === "put") putVolume += vol;

    totalNotional += notional;

    // For weighted vol/OI: only strikes with OI >= 200
    if (oi >= CFG.blockOiMin && vol > 0) {
      const voiRatio = vol / oi;
      weightedVolOiNum += voiRatio * notional;
      weightedVolOiDen += notional;
    }

    if (vol >= CFG.blockMinContracts) {
      blockCandidates.push({ vol, notional });
    }
  }

  const weightedVolOiRatio = weightedVolOiDen > 0 ? weightedVolOiNum / weightedVolOiDen : 0;

  // Block trade detection: notional > 0.5% of total today's notional AND vol > 500
  if (totalNotional > 0) {
    for (const b of blockCandidates) {
      if (b.notional > CFG.blockNotionalPct * totalNotional) blockCount++;
    }
  }

  // ── IV30d: find ATM option in 20-40 DTE window ──
  let iv30d: number | null = null;
  const iv30Candidates = allResults
    .filter(r => {
      const d = dte(r.details?.expiration_date ?? "");
      const sp = r.details?.strike_price ?? 0;
      return d >= 20 && d <= 40 && sp > 0 && (r.implied_volatility ?? 0) > 0;
    })
    .map(r => ({
      dte: dte(r.details?.expiration_date ?? ""),
      strike: r.details?.strike_price ?? 0,
      iv: r.implied_volatility ?? 0,
    }))
    .sort((a, b) => {
      const aDist = Math.abs(a.strike - spot) + Math.abs(a.dte - 30) * 0.5;
      const bDist = Math.abs(b.strike - spot) + Math.abs(b.dte - 30) * 0.5;
      return aDist - bDist;
    });
  if (iv30Candidates.length > 0) iv30d = iv30Candidates[0].iv;

  return {
    liq: { avgSpreadPct, totalOI, score: liqScore },
    flow: { callVolume, putVolume, weightedVolOiRatio, blockCount, totalNotional, dataAvailable: true },
    iv30d,
  };
}

// ─── Scoring functions ─────────────────────────────────────────────────────

// Category 1: Setup Quality (20 pts)
function score1A(price: number, sma20: number): number {
  const d = Math.abs(price - sma20) / sma20 * 100;
  if (d <= 1.0) return 7;
  if (d <= 3.0) return 5;
  if (d <= 6.0) return 3;
  if (d <= 10.0) return 1;
  return 0;
}

function score1B(atr5: number | null, atr20: number | null): number {
  if (!atr5 || !atr20 || atr20 === 0) return 0;
  const rc = atr5 / atr20;
  if (rc <= 0.50) return 7;
  if (rc <= 0.65) return 5;
  if (rc <= 0.80) return 3;
  if (rc <= 1.00) return 1;
  return 0;
}

function score1C(pulseBias: string, price: number, sma20: number): { score: number; signal: "BULLISH" | "BEARISH" | "NEUTRAL" } {
  const isBull = pulseBias.includes("BULLISH");
  const isBear = pulseBias.includes("BEARISH");
  const priceAbove = price > sma20;
  if ((isBull) && priceAbove) return { score: 6, signal: "BULLISH" };
  if ((isBear) && !priceAbove) return { score: 6, signal: "BEARISH" };
  if (!isBull && !isBear) return { score: 3, signal: "NEUTRAL" }; // NEUTRAL pulse
  return { score: 2, signal: "NEUTRAL" }; // conflicting
}

// Category 2: Accumulation Pattern (15 pts)
function score2A(volumes: number[]): { score: number; vr: number } {
  const vol5 = median(volumes.slice(-5));
  const vol20 = median(volumes.slice(-20));
  if (vol20 === 0) return { score: 0, vr: 0 };
  const vr = vol5 / vol20;
  if (vr >= 1.2 && vr <= 2.0) return { score: 6, vr };
  if (vr > 1.0 && vr < 1.2) return { score: 3, vr };
  if (vr > 2.0 && vr <= 3.0) return { score: 2, vr };
  return { score: 0, vr };
}

function score2B(vr: number, pctChange5d: number | null): number {
  if (vr < 1.2 || pctChange5d === null) return 0;
  const p = pctChange5d;
  if (p > -2.0 && p <= 2.0) return 5;
  if (p > 2.0 && p <= 4.0) return 3;
  if (p >= -4.0 && p < -2.0) return 3;
  return 0;
}

function score2C(candles: Candle[]): { score: number; obvSlopeSign: "BULLISH" | "BEARISH" | "NEUTRAL" } {
  if (candles.length < 20) return { score: 0, obvSlopeSign: "NEUTRAL" };
  const obv = computeOBV(candles);
  const obv10 = obv.slice(-10);
  const avgVol20 = candles.slice(-20).map(c => c.volume).reduce((a, b) => a + b, 0) / 20;
  const rawSlope = linRegSlope(obv10);
  const normSlope = avgVol20 > 0 ? rawSlope / avgVol20 : 0;
  const pct10d = computePercentChange(candles.map(c => c.close), 10) ?? 0;
  const isFlat = Math.abs(normSlope) < CFG.obvFlatThreshold;
  if (isFlat) return { score: 0, obvSlopeSign: "NEUTRAL" };
  const priceFlat = pct10d >= -2 && pct10d <= 2;
  if (normSlope > 0 && priceFlat) return { score: 4, obvSlopeSign: "BULLISH" };
  if (normSlope < 0 && priceFlat) return { score: 3, obvSlopeSign: "BEARISH" };
  // slope direction matches price direction
  const priceBull = pct10d > 0;
  if ((normSlope > 0 && priceBull) || (normSlope < 0 && !priceBull)) return { score: 1, obvSlopeSign: normSlope > 0 ? "BULLISH" : "BEARISH" };
  return { score: 0, obvSlopeSign: "NEUTRAL" };
}

// Category 3: IV Setup (25 pts)
function score3A(ivr: number): number {
  if (ivr >= 70) return 7;
  if (ivr >= 50) return 5;
  if (ivr >= 35) return 3;
  if (ivr >= 20) return 1;
  return 0;
}

function score3B(ivr: number, ivr5dAgo: number | null, earningsWithin14d: boolean): number {
  if (ivr5dAgo === null) return 0;
  const change = ivr - ivr5dAgo;
  let s = 0;
  if (change >= 15) s = 10;
  else if (change >= 10) s = 8;
  else if (change >= 7) s = 6;
  else if (change >= 3) s = 4;
  else if (change >= 1) s = 2;
  return earningsWithin14d ? Math.min(s, 4) : s;
}

function score3C(iv30d: number | null, hv20d: number, earningsWithin14d: boolean): number {
  if (!iv30d || iv30d <= 0 || hv20d <= 0) return 0;
  const ratio = iv30d / hv20d;
  let s = 0;
  if (ratio >= 1.50) s = 8;
  else if (ratio >= 1.30) s = 6;
  else if (ratio >= 1.15) s = 4;
  else if (ratio >= 1.05) s = 2;
  return earningsWithin14d ? Math.min(s, 3) : s;
}

// Category 4: Flow Divergence (25 pts)
function score4A(weightedVolOiRatio: number): number {
  if (weightedVolOiRatio >= 0.80) return 8;
  if (weightedVolOiRatio >= 0.50) return 6;
  if (weightedVolOiRatio >= 0.30) return 4;
  if (weightedVolOiRatio >= 0.15) return 2;
  return 0;
}

function score4B(callVol: number, putVol: number): { score: number; skewSignal: "BULLISH" | "BEARISH" | "NEUTRAL" } {
  const total = callVol + putVol;
  if (total === 0) return { score: 0, skewSignal: "NEUTRAL" };
  const skew = Math.abs(callVol - putVol) / total;
  const dir: "BULLISH" | "BEARISH" | "NEUTRAL" = callVol > putVol ? "BULLISH" : callVol < putVol ? "BEARISH" : "NEUTRAL";
  if (skew >= 0.70) return { score: 5, skewSignal: dir };
  if (skew >= 0.50) return { score: 4, skewSignal: dir };
  if (skew >= 0.30) return { score: 2, skewSignal: dir };
  return { score: 0, skewSignal: "NEUTRAL" };
}

function score4C(blockCount: number): number {
  if (blockCount >= 3) return 5;
  if (blockCount >= 2) return 3;
  if (blockCount >= 1) return 2;
  return 0;
}

function score4D(callVol: number, putVol: number, pct5d: number | null): { score: number; flowDir: "BULLISH" | "BEARISH" | "NEUTRAL" } {
  let flowDir: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";
  if (callVol === 0 && putVol === 0) flowDir = "NEUTRAL";
  else if (callVol > 1.5 * putVol) flowDir = "BULLISH";
  else if (putVol > 1.5 * callVol) flowDir = "BEARISH";

  const priceDir: "UP" | "DOWN" | "FLAT" =
    pct5d == null ? "FLAT" : pct5d > 2 ? "UP" : pct5d < -2 ? "DOWN" : "FLAT";

  if (flowDir === "NEUTRAL") return { score: 0, flowDir };
  if (flowDir === "BULLISH" && (priceDir === "FLAT" || priceDir === "DOWN")) return { score: 7, flowDir };
  if (flowDir === "BEARISH" && (priceDir === "FLAT" || priceDir === "UP")) return { score: 7, flowDir };
  if (flowDir === "BULLISH" && priceDir === "UP") return { score: 2, flowDir };
  if (flowDir === "BEARISH" && priceDir === "DOWN") return { score: 2, flowDir };
  return { score: 0, flowDir };
}

// Category 5: Emerging Relative Strength (15 pts)
function score5A(tickerCloses: number[], spyCloses: number[]): { score: number; rsSign: "BULLISH" | "BEARISH" | "NEUTRAL" } {
  const minLen = Math.min(tickerCloses.length, spyCloses.length);
  if (minLen < 22) return { score: 0, rsSign: "NEUTRAL" };
  const tSlice = tickerCloses.slice(-minLen);
  const sSlice = spyCloses.slice(-minLen);
  const ratios = tSlice.map((t, i) => (sSlice[i] > 0 ? t / sSlice[i] : 0));
  const rs5 = ratios.slice(-5);
  const rs20 = ratios.slice(-20);
  const slope5 = linRegSlope(rs5);
  const slope20 = linRegSlope(rs20);
  const avgRs5 = rs5.reduce((a, b) => a + b, 0) / rs5.length;
  const avgRs20 = rs20.reduce((a, b) => a + b, 0) / rs20.length;
  const ns5 = avgRs5 > 0 ? slope5 / avgRs5 : 0;
  const ns20 = avgRs20 > 0 ? slope20 / avgRs20 : 0;
  const flat5 = Math.abs(ns5) < CFG.rsFlatThreshold;
  if (flat5) return { score: 0, rsSign: "NEUTRAL" };
  const bull5 = ns5 > 0;
  const bull20 = ns20 > 0;
  const flat20 = Math.abs(ns20) < CFG.rsFlatThreshold;
  const rsSign: "BULLISH" | "BEARISH" = bull5 ? "BULLISH" : "BEARISH";
  if (bull5 && (!bull20 || flat20)) return { score: 8, rsSign };  // bullish turn from weakness
  if (!bull5 && (bull20 || flat20)) return { score: 8, rsSign };  // bearish turn from strength
  if (bull5 && bull20) return { score: 3, rsSign: "BULLISH" };    // established bullish RS
  return { score: 3, rsSign: "BEARISH" };                          // established bearish RS
}

function score5B(tickerCloses: number[], sectorCloses: number[]): number {
  const pTicker = computePercentChange(tickerCloses, 5) ?? 0;
  const pSector = computePercentChange(sectorCloses, 5) ?? 0;
  const div = Math.abs(pTicker - pSector);
  if (div >= 3.0) return 7;
  if (div >= 1.5) return 4;
  if (div >= 0.5) return 2;
  return 0;
}

// ─── Directional lean ─────────────────────────────────────────────────────
function computeDirectionalLean(
  pulseSignal: "BULLISH" | "BEARISH" | "NEUTRAL",
  obvSignal: "BULLISH" | "BEARISH" | "NEUTRAL",
  flowSkewSignal: "BULLISH" | "BEARISH" | "NEUTRAL",
  flowDirSignal: "BULLISH" | "BEARISH" | "NEUTRAL",
  rsSignal: "BULLISH" | "BEARISH" | "NEUTRAL",
  flowDataAvailable: boolean,
): "BULLISH" | "BEARISH" | "MIXED" {
  const signals = flowDataAvailable
    ? [pulseSignal, obvSignal, flowSkewSignal, flowDirSignal, rsSignal]
    : [pulseSignal, obvSignal, rsSignal];

  const bullCount = signals.filter(s => s === "BULLISH").length;
  const bearCount = signals.filter(s => s === "BEARISH").length;
  const threshold = flowDataAvailable ? 4 : 3;

  if (bullCount >= threshold) return "BULLISH";
  if (bearCount >= threshold) return "BEARISH";
  return "MIXED";
}

// ─── Guardrail filter ──────────────────────────────────────────────────────
const EXCLUDED_ETFS = new Set([
  "SQQQ","TQQQ","SPXU","SPXL","SOXL","SOXS","LABU","LABD","TNA","TZA","UVXY","SVXY",
  "UPRO","SDOW","UDOW","FNGU","FNGD","NUGT","DUST","JNUG","JDST","BOIL","KOLD",
  "YANG","YINN","WEBL","WEBS","BULZ","BERZ","TECS","TECL","FAS","FAZ",
]);

function passesGuardrails(sym: string, price: number, avgVol?: number): { passes: boolean; reason?: string } {
  if (EXCLUDED_ETFS.has(sym.toUpperCase())) return { passes: false, reason: "ETF excluded from scan" };
  if (price < CFG.minPrice) return { passes: false, reason: `Price $${price.toFixed(2)} below $${CFG.minPrice}` };
  if (avgVol != null && avgVol < CFG.minAvgVol) return { passes: false, reason: `Avg vol ${avgVol.toLocaleString()} below 500k` };
  return { passes: true };
}

// ─── Main Discovery scan runner ────────────────────────────────────────────
type WeightProfile = { trend: number; rs: number; volume: number; ivr: number; liquidity: number };

type ScannerTelemetryInsert = InferInsertModel<typeof scannerTelemetryTable>;

/** Top rows stored in `scanner_telemetry.results` (subset of each scan candidate). */
interface ScannerTelemetryResultRow {
  symbol: string;
  score: number;
  lean?: "BULLISH" | "BEARISH" | "MIXED";
}

function resolveWeightProfile(cfg: StrategistConfig, regime: StructuredRegime | null): { weights: WeightProfile; mode: "DEFAULT" | "IDIOSYNCRATIC" } {
  const useIdio = regime && regime.idioOpportunityFlag === true;
  if (useIdio) {
    return {
      mode: "IDIOSYNCRATIC",
      weights: {
        trend: cfg.scannerIdioTrend,
        rs: cfg.scannerIdioRS,
        volume: cfg.scannerIdioVolume,
        ivr: cfg.scannerIdioIVR,
        liquidity: cfg.scannerIdioLiquidity,
      },
    };
  }
  return {
    mode: "DEFAULT",
    weights: {
      trend: cfg.scannerDefaultTrend,
      rs: cfg.scannerDefaultRS,
      volume: cfg.scannerDefaultVolume,
      ivr: cfg.scannerDefaultIVR,
      liquidity: cfg.scannerDefaultLiquidity,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Bucket caps (Part 4 rebalance):
//   SetupQuality 15  Accumulation 15  IV 20  Flow 15  LiveFlow 20  RS 15  = 100
// Note: existing scoring functions still emit values up to their *original*
// caps (SQ→20, IV→25, Flow→25). We re-normalize to the new caps without
// clamping by dividing by the original cap (preserves resolution) — the
// "rebalance" is structural (introducing the LIVE_FLOW slot) rather than
// punitive on existing scores. The dynamic regime weights (WeightProfile)
// stay unchanged; w.liquidity is split between Flow and LiveFlow by their
// cap ratio (15/35 vs 20/35) so the total liquidity-weight envelope is
// preserved across regimes.
// ─────────────────────────────────────────────────────────────────────────────
const BUCKET_MAX_SETUP_LEGACY = 20;
const BUCKET_MAX_IV_LEGACY = 25;
const BUCKET_MAX_FLOW_LEGACY = 25;
const BUCKET_MAX_ACC = 15;
const BUCKET_MAX_RS = 15;
const BUCKET_MAX_LIVE_FLOW = 20;
const FLOW_WEIGHT_SHARE = 15 / 35;       // Flow share of w.liquidity
const LIVE_FLOW_WEIGHT_SHARE = 20 / 35;  // LiveFlow share of w.liquidity

function applyDynamicWeights(
  w: WeightProfile,
  setupQuality: number,
  accumulation: number,
  ivSetup: number,
  flowDivergence: number,
  emergingRS: number,
  flowDataAvailable: boolean,
  liveFlow: number = 0,
  liveFlowAvailable: boolean = false,
): number {
  const normTrend = setupQuality / BUCKET_MAX_SETUP_LEGACY;
  const normVol = accumulation / BUCKET_MAX_ACC;
  const normIVR = ivSetup / BUCKET_MAX_IV_LEGACY;
  const normFlow = flowDataAvailable ? flowDivergence / BUCKET_MAX_FLOW_LEGACY : 0;
  const normLive = liveFlowAvailable ? Math.min(1, liveFlow / BUCKET_MAX_LIVE_FLOW) : 0;
  const normRS = emergingRS / BUCKET_MAX_RS;

  // Compose weighted sum, only including buckets whose data is available so
  // the denominator (totalW) skips missing-data slots and the score isn't
  // depressed by them.
  const flowWeight = flowDataAvailable ? w.liquidity * FLOW_WEIGHT_SHARE : 0;
  const liveWeight = liveFlowAvailable ? w.liquidity * LIVE_FLOW_WEIGHT_SHARE : 0;
  const totalW = w.trend + w.volume + w.ivr + flowWeight + liveWeight + w.rs;
  if (totalW === 0) return 0;
  const num = normTrend * w.trend
            + normVol * w.volume
            + normIVR * w.ivr
            + normFlow * flowWeight
            + normLive * liveWeight
            + normRS * w.rs;
  return Math.round((num / totalW) * 100);
}

export async function runDiscoveryScan(
  symbols: string[],
  accessToken: string,
  traderToken: string | null,
  pulse: { composite: number; confidence: number; bias: string },
  log: { info: (...args: any[]) => void; warn: (...args: any[]) => void; error: (...args: any[]) => void },
  options?: { returnAll?: boolean },
): Promise<ScanResult> {
  const scanStart = Date.now();
  const scanBatch = createTelemetryBatch("SCANNER");

  const cfg = await getSettings();
  const regime = getCachedRegime() ?? buildFallbackRegime();
  const { weights: scanWeights, mode: weightMode } = resolveWeightProfile(cfg, regime);
  const minScore = cfg.scannerMinScore ?? CFG.minScore;

  emitTelemetry("SCANNER", "INFO", `Discovery scan initiated — ${symbols.length} tickers (${weightMode} mode, minScore=${minScore})`, {
    totalTickers: symbols.length, pulseBias: pulse.bias, mode: "DISCOVERY", weightMode, scanWeights, minScore,
  }, "SCANNER", scanBatch);

  emitTelemetry("SCHWAB_API", "INFO", `Scanner: fetching quotes for ${symbols.length} symbols`, { endpoint: "/quotes", symbols: symbols.length }, "SCANNER", scanBatch);
  const quoteMap = await fetchQuotesBatch(symbols, accessToken);
  emitTelemetry("SCHWAB_API", "INFO", `Scanner: received ${quoteMap.size}/${symbols.length} quotes`, { endpoint: "/quotes", received: quoteMap.size, requested: symbols.length }, "SCANNER", scanBatch);
  const portfolioSymbols = traderToken ? await fetchPortfolioSymbols(traderToken) : new Set<string>();

  const filterResults: FilterResult[] = [];
  const passedSymbols: string[] = [];

  for (const sym of symbols) {
    const q = quoteMap.get(sym.toUpperCase());
    if (!q) { filterResults.push({ symbol: sym, passed: false, reason: "No quote data" }); continue; }

    const guardResult = passesGuardrails(sym, q.lastPrice, q.avgVol);
    if (!guardResult.passes) { filterResults.push({ symbol: sym, passed: false, reason: guardResult.reason }); continue; }

    if (portfolioSymbols.has(sym.toUpperCase())) { filterResults.push({ symbol: sym, passed: false, reason: "Open position held" }); continue; }

    filterResults.push({ symbol: sym, passed: true });
    passedSymbols.push(sym);
  }

  log.info({ total: symbols.length, passed: passedSymbols.length }, "Discovery Stage 1: pre-filter complete");

  // ── Batch-load historical data from DB (T003 refactor) ──
  const neededEtfs = [...new Set(passedSymbols.map(s => getSectorEtf(s)).concat(["SPY"]))];
  const allSymbolsForDB = [...new Set([...passedSymbols, ...neededEtfs])];

  emitTelemetry("DATABASE", "INFO", `Scanner: loading equity history for ${allSymbolsForDB.length} symbols from DB`, { symbols: allSymbolsForDB.length }, "SCANNER", scanBatch);
  const [equityHistoryMap, flowDataMap, dbIvr, flowAccelMap] = await Promise.all([
    fetchEquityHistoryFromDB(allSymbolsForDB),
    fetchFlowDataFromDB(passedSymbols),
    fetchIvrFromDB(passedSymbols),
    // Part 1.3: trailing 3d-vs-20d options-volume acceleration from
    // polygon_options_history (flat files). Returns an empty map if the
    // backfill is sparse — handled by graceful degradation in the loop.
    // Use the same trailing-window shape as the Part 1.4 unusual-flow screen
    // (recent 5d vs prior 15d), so the per-symbol LIVE_FLOW input and the
    // /api/unusual-options/trailing endpoint are sourced from an identical
    // signal — just one is per-symbol, the other is screen-wide.
    getFlowAcceleration(passedSymbols, { recentDays: 5, trailingDays: 15 }).catch((err) => {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "FlowAcceleration query failed — continuing without bonus");
      return new Map();
    }),
  ]);
  emitTelemetry("DATABASE", "INFO", `Scanner: loaded ${equityHistoryMap.size} equity histories, ${flowDataMap.size} flow records, ${dbIvr.currentIvr.size} IVR values, ${flowAccelMap.size} flow-accel baselines from DB`, {
    equitySymbols: equityHistoryMap.size, flowSymbols: flowDataMap.size, ivrSymbols: dbIvr.currentIvr.size, flowAccelSymbols: flowAccelMap.size,
  }, "SCANNER", scanBatch);

  const etfHistories = new Map<string, Candle[]>();
  for (const etf of neededEtfs) {
    const c = equityHistoryMap.get(etf);
    if (c && c.length > 0) etfHistories.set(etf, c);
  }
  const spyCandles = etfHistories.get("SPY") ?? [];
  const spyCloses = spyCandles.map(c => c.close);

  // ── Score each symbol ──
  const scoredResults: Array<{
    symbol: string; totalScore: number; rawScores: { s1a:number;s1b:number;s1c:number;s2a:number;s2b:number;s2c:number;s3a:number;s3b:number;s3c:number;s4a:number;s4b:number;s4c:number;s4d:number;s5a:number;s5b:number };
    setupQuality: number; accumulation: number; ivSetup: number; flowDivergence: number; emergingRS: number;
    liveFlow: number; liveFlowAvailable: boolean;
    liqScore: number; flowDataAvailable: boolean;
    directionalLean: "BULLISH" | "BEARISH" | "MIXED";
    quote: { lastPrice: number; totalVolume: number; netPercentChange: number }; candles: Candle[];
    ivr: number; iv30d: number | null; atmSpreadPct: number;
    polygonHighlights?: PolygonFlowHighlights | null;
    unusualFlowBonus?: number;
  }> = [];

  for (const sym of passedSymbols) {
    try {
      const quote = quoteMap.get(sym.toUpperCase())!;
      const spot = quote.lastPrice;

      const candles = equityHistoryMap.get(sym) ?? equityHistoryMap.get(sym.toUpperCase()) ?? [];
      const polyData = flowDataMap.get(sym) ?? flowDataMap.get(sym.toUpperCase()) ?? null;

      if (candles.length < CFG.ipoMinDays) {
        const idx = filterResults.findIndex(f => f.symbol === sym);
        if (idx >= 0) filterResults[idx] = { symbol: sym, passed: false, reason: `Insufficient history (${candles.length}d < ${CFG.ipoMinDays}d)` };
        continue;
      }

      const liqMetrics = polyData ? computeLiqFromStrikes(polyData.strikes, spot) : { avgSpreadPct: 99, totalOI: 0, score: 0 };
      const liqScore = liqMetrics.score;
      const atmSpreadPct = liqMetrics.avgSpreadPct;
      if (polyData && liqScore < CFG.liquidityGateMinScore) {
        const idx = filterResults.findIndex(f => f.symbol === sym);
        if (idx >= 0) filterResults[idx] = { symbol: sym, passed: false, reason: `Liquidity gate failed (score ${liqScore} < 8, spread ${atmSpreadPct.toFixed(1)}%)` };
        emitTelemetry("SCANNER", "WARN", `${sym} — SKIP: liquidity gate (score ${liqScore})`, { ticker: sym, liqScore, spread: atmSpreadPct }, "SCANNER", scanBatch);
        continue;
      }

      const closes = candles.map(c => c.close);
      const volumes = candles.map(c => c.volume);
      const sma20 = computeSMA(closes, 20);
      const atr5 = computeATR(candles, 5);
      const atr20 = computeATR(candles, 20);
      const hv20d = computeHV20(closes);
      const pct5d = computePercentChange(closes, 5);
      const sectorEtf = getSectorEtf(sym);
      const sectorCandles = etfHistories.get(sectorEtf) ?? etfHistories.get("SPY") ?? [];
      const sectorCloses = sectorCandles.map(c => c.close);

      // Earnings flags — single source of truth: vendor calendar primary, Yahoo fallback, 6h cache.
      // Calendar-event MEGA_EARNINGS list is intentionally NOT consulted here so the suppress
      // window applies uniformly to every ticker, not just the hand-maintained mega caps.
      const suppressDays = cfg.earningsSuppressDays ?? CFG.earningsSuppressDays;
      let earningsWithin14d = false;
      if (suppressDays > 0) {
        const earningsInfo = await getNextEarningsDate(sym).catch(() => null);
        earningsWithin14d =
          earningsInfo?.daysAway != null && earningsInfo.daysAway <= suppressDays;
      }
      void checkEventConflicts; // referenced below for non-ticker macro events only

      // ── Category 1 ──
      const s1a = sma20 ? score1A(spot, sma20) : 0;
      const s1b = score1B(atr5, atr20);
      const { score: s1cScore, signal: pulseSignal } = sma20 ? score1C(pulse.bias, spot, sma20) : { score: 2, signal: "NEUTRAL" as const };
      const s1c = s1cScore;
      const setupQuality = s1a + s1b + s1c;

      // ── Category 2 ──
      if (volumes.length < 20) continue;
      const { score: s2a, vr } = score2A(volumes);
      const s2b = score2B(vr, pct5d);
      const { score: s2c, obvSlopeSign } = score2C(candles);
      const accumulation = s2a + s2b + s2c;

      // ── Category 3 ──
      const iv30d: number | null = polyData?.iv30d ?? null;

      const symUpper = sym.toUpperCase();
      let ivr = dbIvr.currentIvr.get(symUpper) ?? 50;
      ivr = Math.max(0, Math.min(100, ivr));

      const ivr5dAgo = dbIvr.ivrNdAgo.get(symUpper) ?? null;

      const s3a = score3A(ivr);
      const s3b = score3B(ivr, ivr5dAgo, earningsWithin14d);
      const s3c = score3C(iv30d, hv20d, earningsWithin14d);
      const ivSetup = s3a + s3b + s3c;

      // ── Category 4 ──
      let flowDivergence = 0;
      let flowDataAvailable = false;
      let s4a = 0, s4b = 0, s4c = 0, s4d = 0;
      let flowSkewSignal: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";
      let flowDirSignal: "BULLISH" | "BEARISH" | "NEUTRAL" = "NEUTRAL";

      if (polyData?.flow.dataAvailable) {
        flowDataAvailable = true;
        const f = polyData.flow;
        s4a = score4A(f.weightedVolOiRatio);
        const b4b = score4B(f.callVolume, f.putVolume);
        s4b = b4b.score;
        flowSkewSignal = b4b.skewSignal;
        s4c = score4C(f.blockCount);
        const d4d = score4D(f.callVolume, f.putVolume, pct5d);
        s4d = d4d.score;
        flowDirSignal = d4d.flowDir;
        flowDivergence = s4a + s4b + s4c + s4d;
      }

      // ── Part 4: LIVE_FLOW bucket (replaces the Part 1.3 Flow-bucket boost) ──
      // Trailing flow acceleration now feeds the dedicated LIVE_FLOW bucket
      // (computeLiveFlowBucket). Until Part 2's WS watcher is live, the
      // bucket is sourced purely from the trailing accel ratio (synthetic
      // events). When Part 2 ships, liveEventCount will come from the
      // session log and dominate the blend.
      const accel = flowAccelMap.get(symUpper) ?? null;
      const flowAccelPts = flowAccelerationPoints(accel); // legacy telemetry only
      // Part 2: pull live session inputs from the persistent watcher. When
      // disabled or the ticker isn't in the watchlist, both fall back to
      // safe defaults and computeLiveFlowBucket degrades to trailing-only.
      const liveStats = isWatcherEnabled() ? getLiveSessionStats(symUpper) : null;
      const liveFlowResult = computeLiveFlowBucket({
        liveEventCount: liveStats?.liveEventCount ?? 0,
        trailingAccel: accel,
        directionallyBalanced: liveStats?.directionallyBalanced ?? false,
      });
      const liveFlow = liveFlowResult.score;
      const liveFlowAvailable = liveFlowResult.available;

      const diagIdx = passedSymbols.indexOf(sym);
      if (diagIdx >= 0 && diagIdx < 3) {
        // [LIVE_FL_DIAG] Per-symbol inputs (Polygon WS + trailing DB accel). fetchPolygonChain logs only if watcher resolves chains.
        // eslint-disable-next-line no-console
        console.log("[LIVE_FL_DIAG] discovery row", {
          symbol: symUpper,
          watcherEnabled: isWatcherEnabled(),
          liveStats,
          trailingAccel: accel
            ? { ratio: accel.ratio, recent3dAvg: accel.recent3dAvg, trailing20dAvg: accel.trailing20dAvg }
            : null,
          liveFlow,
          liveFlowAvailable,
        });
      }

      // ── Category 5 ──
      const { score: s5a, rsSign } = score5A(closes, spyCloses);
      const s5b = score5B(closes, sectorCloses);
      const emergingRS = s5a + s5b;

      // ── Composite (dynamic weights from settings + regime) ──
      let totalScore = applyDynamicWeights(scanWeights, setupQuality, accumulation, ivSetup, flowDivergence, emergingRS, flowDataAvailable, liveFlow, liveFlowAvailable);

      // ── Directional lean ──
      const directionalLean = computeDirectionalLean(pulseSignal, obvSlopeSign, flowSkewSignal, flowDirSignal, rsSign, flowDataAvailable);

      emitTelemetry("SCANNER", "INFO",
        `${sym} DISCOVERY ${totalScore} — SQ ${setupQuality} ACC ${accumulation} IV ${ivSetup} FLOW ${flowDivergence} LIVE ${liveFlow}${liveFlowAvailable ? ` (${liveFlowResult.effectiveEvents}ev${liveFlowResult.penaltyApplied ? ",-bal" : ""})` : ""} RS ${emergingRS} | ${directionalLean}`, {
        ticker: sym, totalScore, setupQuality, accumulation, ivSetup, flowDivergence, emergingRS, directionalLean, flowDataAvailable, pass: totalScore >= CFG.minScore,
        flowAccelerationPts: flowAccelPts, flowAccelerationRatio: accel?.ratio ?? null,
        liveFlow, liveFlowAvailable, liveFlowEvents: liveFlowResult.effectiveEvents,
      }, "SCANNER", scanBatch);

      scoredResults.push({
        symbol: sym, totalScore,
        rawScores: { s1a, s1b, s1c, s2a, s2b, s2c, s3a, s3b, s3c, s4a, s4b, s4c, s4d, s5a, s5b },
        setupQuality, accumulation, ivSetup, flowDivergence, emergingRS,
        liveFlow, liveFlowAvailable,
        liqScore, flowDataAvailable, directionalLean,
        quote: { lastPrice: spot, totalVolume: quote.totalVolume, netPercentChange: quote.netPercentChange },
        candles, ivr, iv30d, atmSpreadPct,
      });
    } catch (err) {
      log.warn({ symbol: sym, error: err instanceof Error ? err.message : String(err) }, "Discovery: error scoring symbol");
    }
  }

  // ── Catalyst bonus in idiosyncratic mode ──
  const catalystBonusApplied: string[] = [];
  if (weightMode === "IDIOSYNCRATIC" && cfg.catalystBonusPoints > 0) {
    for (const r of scoredResults) {
      try {
        const ioResult = await computeIOScore(r.symbol, { flagValue: 0, reason: "scanner_probe" });
        if (ioResult.components.catalyst.flagValue > 0) {
          r.totalScore = Math.min(100, r.totalScore + cfg.catalystBonusPoints);
          catalystBonusApplied.push(r.symbol);
        }
      } catch {}
    }
    if (catalystBonusApplied.length > 0) {
      emitTelemetry("SCANNER", "INFO", `Catalyst bonus (+${cfg.catalystBonusPoints}) applied to: ${catalystBonusApplied.join(", ")}`, {
        symbols: catalystBonusApplied, bonus: cfg.catalystBonusPoints,
      }, "SCANNER", scanBatch);
    }
  }

  // ── On-demand flow capture for top-N scanner candidates (shared WebSocket budget) ──
  if (CFG.flowCaptureTopN > 0) {
    const sortedForCapture = [...scoredResults].sort((a, b) => b.totalScore - a.totalScore);
    const captureSyms = sortedForCapture.slice(0, CFG.flowCaptureTopN).map((r) => r.symbol);
    for (let i = 0; i < captureSyms.length; i += CFG.flowCaptureConcurrency) {
      const batch = captureSyms.slice(i, i + CFG.flowCaptureConcurrency);
      await Promise.all(
        batch.map((sym) =>
          requestFlowCapture(sym, { timeout: 90_000 }).catch((err) => {
            logger.warn({ err, sym }, "deterministicScanner: requestFlowCapture failed");
            return null;
          }),
        ),
      );
    }
  }

  // ── Unusual options activity bonus (Polygon per-strike highlights) ──
  // Bulk-fetch Polygon highlights for every scored ticker, then add up to
  // +10 points for tickers showing real unusual options activity. This lets
  // the scanner surface tickers where smart money is paying up even if the
  // underlying price hasn't moved enough to score on trend/RS alone.
  const polygonHighlightsMap = await getPolygonFlowHighlightsBulk(scoredResults.map(r => r.symbol));
  const unusualFlowApplied: Array<{ sym: string; bonus: number; strikes: number; skew: string }> = [];
  for (const r of scoredResults) {
    const h = polygonHighlightsMap.get(r.symbol.toUpperCase()) ?? null;
    r.polygonHighlights = h;
    const bonus = unusualFlowBonusPoints(h);
    if (bonus > 0) {
      r.unusualFlowBonus = bonus;
      r.totalScore = Math.min(100, r.totalScore + bonus);
      unusualFlowApplied.push({ sym: r.symbol, bonus, strikes: h!.unusualStrikeCount, skew: h!.unusualSkew });
    }
  }
  if (unusualFlowApplied.length > 0) {
    emitTelemetry("SCANNER", "INFO",
      `Unusual flow bonus applied to ${unusualFlowApplied.length} tickers (top: ${unusualFlowApplied.slice(0, 5).map(x => `${x.sym}+${x.bonus}/${x.strikes}/${x.skew}`).join(", ")})`,
      { applied: unusualFlowApplied }, "SCANNER", scanBatch);
  }

  scoredResults.sort((a, b) => b.totalScore - a.totalScore);
  const aboveThreshold = scoredResults.filter(r => r.totalScore >= minScore);

  // Always surface tickers that triggered the unusual-flow detector, even if
  // their composite score didn't clear minScore. The "Unusual flow only" UI
  // filter is meant to expose real flow signal — gating it behind trend/RS
  // would silently hide the very tickers the user is asking to see.
  const unusualFlowTickers = scoredResults.filter(r => (r.unusualFlowBonus ?? 0) > 0);
  const candidatePoolMap = new Map<string, typeof scoredResults[number]>();
  for (const r of aboveThreshold) candidatePoolMap.set(r.symbol.toUpperCase(), r);
  for (const r of unusualFlowTickers) candidatePoolMap.set(r.symbol.toUpperCase(), r);
  const candidatePool = Array.from(candidatePoolMap.values()).sort((a, b) => b.totalScore - a.totalScore);

  const scoreDistrib = scoredResults.slice(0, 10).map(r => `${r.symbol}=${r.totalScore}(SQ${r.setupQuality}/ACC${r.accumulation}/IV${r.ivSetup}/FL${r.flowDivergence}/RS${r.emergingRS})`);
  log.info({ scored: scoredResults.length, above: aboveThreshold.length, unusualFlowAdded: candidatePool.length - aboveThreshold.length, distribution: scoreDistrib }, "Discovery scoring complete");

  // Part 6 — observability: per-scan LIVE_FLOW counter aggregate. Lets
  // operators answer "how many candidates this scan had a usable LIVE_FLOW
  // signal, and how strong was it on average" via a single grep. Pairs
  // with the per-baseline counters in optionsBaselines.ts.
  const lfAvail = scoredResults.filter(r => r.liveFlowAvailable);
  const lfAvgScore = lfAvail.length > 0
    ? +(lfAvail.reduce((s, r) => s + r.liveFlow, 0) / lfAvail.length).toFixed(2)
    : 0;
  log.info({
    op: "scanner.liveFlow.applied",
    scoped: scoredResults.length,
    available: lfAvail.length,
    coverageRate: scoredResults.length > 0 ? +(lfAvail.length / scoredResults.length).toFixed(3) : 0,
    avgLiveFlowScore: lfAvgScore,
    maxLiveFlowScore: lfAvail.reduce((m, r) => Math.max(m, r.liveFlow), 0),
  }, "scanner.liveFlow.applied");

  const { getUpcomingEvents } = await import("./calendarEventChecker.js");

  // Pre-fetch ticker-specific earnings via the unified helper (cached). This replaces the
  // legacy MEGA_EARNINGS-driven `checkEventConflicts` lookup for ticker-specific events,
  // so non-mega-cap candidates also surface their real earnings dates.
  const earningsBySymbol = new Map<string, { date: string; confirmed: boolean; source: string | null }>();
  await Promise.all(candidatePool.map(async (r) => {
    const info = await getNextEarningsDate(r.symbol).catch(() => null);
    if (info?.earningsDate) {
      earningsBySymbol.set(r.symbol.toUpperCase(), {
        date: info.earningsDate,
        confirmed: info.confirmed,
        source: info.source,
      });
    }
  }));

  const candidates: ScanCandidate[] = candidatePool.map(r => {
    // Macro-only events (FOMC, CPI, OpEx, etc) — exclude any "earnings" type since those
    // are now sourced exclusively from the unified earnings helper above.
    const upcoming = getUpcomingEvents(30)
      .filter(e => e.type !== "earnings" && e.importance === "HIGH")
      .slice(0, 5)
      .map(e => ({ date: e.date, title: e.title, importance: e.importance }));

    const earn = earningsBySymbol.get(r.symbol.toUpperCase());
    const tickerSpecific: Array<{ date: string; title: string; importance: string }> = earn
      ? [{
          date: earn.date,
          title: `${r.symbol} Earnings${earn.confirmed ? "" : " (est)"}`,
          importance: "HIGH",
        }]
      : [];

    const allUpcoming = [...tickerSpecific, ...upcoming]
      .filter((v, i, a) => a.findIndex(e => e.date === v.date && e.title === v.title) === i)
      .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);

    const h = r.polygonHighlights ?? null;
    const unusualFlow = h && h.unusualStrikeCount > 0
      ? {
          asOfDate: h.asOfDate,
          unusualStrikeCount: h.unusualStrikeCount,
          skew: h.unusualSkew,
          bonusPoints: r.unusualFlowBonus ?? 0,
          largestPrintVolume: h.largestPrint?.volume ?? 0,
          largestPrintDescription: h.largestPrint
            ? `${h.largestPrint.volume.toLocaleString()} contracts on ${r.symbol} ${h.largestPrint.expiration} $${h.largestPrint.strike}${h.largestPrint.optionType === "call" ? "C" : "P"}`
            : null,
          putCallVolumeRatio: h.putCallVolumeRatio,
        }
      : undefined;

    return {
      symbol: r.symbol,
      totalScore: r.totalScore,
      components: {
        trendAlignment: r.setupQuality,
        relativeStrength: r.emergingRS,
        volumeConfirmation: r.accumulation,
        ivrScore: r.ivSetup,
        optionsLiquidity: r.flowDivergence,
      },
      price: r.quote.lastPrice,
      changePct: r.quote.netPercentChange,
      sector: getSector(r.symbol),
      keyStatLabel: unusualFlow ? "Unusual Flow" : (r.flowDataAvailable ? "Flow" : "IV Setup"),
      keyStatValue: unusualFlow
        ? `${unusualFlow.unusualStrikeCount} strikes ${unusualFlow.skew}`
        : (r.flowDataAvailable ? `${r.flowDivergence}/25` : `${r.ivSetup}/25`),
      ivr: Math.round(r.ivr * 10) / 10,
      atmIV: 0,
      atmSpreadPct: r.atmSpreadPct,
      hasWeeklyOptions: true,
      upcomingEvents: allUpcoming,
      microOverrideEligible: r.totalScore >= 90,
      pulseComposite: pulse.composite,
      pulseConfidence: pulse.confidence,
      pulseBias: pulse.bias,
      directionalLean: r.directionalLean,
      scanMode: "DISCOVERY" as const,
      flowDataAvailable: r.flowDataAvailable,
      discoveryComponents: {
        setupQuality: r.setupQuality,
        accumulation: r.accumulation,
        ivSetup: r.ivSetup,
        flowDivergence: r.flowDivergence,
        liveFlow: r.liveFlow,
        liveFlowAvailable: r.liveFlowAvailable,
        emergingRS: r.emergingRS,
      },
    };
  });

  const scanDuration = Date.now() - scanStart;
  emitTelemetry("SCANNER", "INFO",
    `Discovery scan complete — ${candidates.length} candidates in ${(scanDuration / 1000).toFixed(1)}s`, {
    candidates: candidates.length, totalScanned: symbols.length, durationMs: scanDuration,
    topSymbols: candidates.map(c => `${c.symbol}(${c.totalScore} ${c.directionalLean})`).join(", "),
  }, "SCANNER", scanBatch);

  try {
    const telemetryRow: ScannerTelemetryInsert = {
      mode: weightMode,
      regime,
      weightsUsed: scanWeights,
      universeSize: symbols.length,
      passedFilters: scoredResults.length,
      aboveThreshold: aboveThreshold.length,
      thresholdUsed: minScore,
      catalystBonusAppliedTo: catalystBonusApplied,
      results: candidates.slice(0, 20).map(
        (c): ScannerTelemetryResultRow => ({
          symbol: c.symbol,
          score: c.totalScore,
          lean: c.directionalLean,
        }),
      ),
    };
    await db.insert(scannerTelemetryTable).values(telemetryRow);
  } catch (err) {
    log.warn({ error: err instanceof Error ? err.message : String(err) }, "Failed to log scanner telemetry");
  }

  // ── Part 2: post-scan watcher rebalance ──
  // The top-N candidates by totalScore become HOT (highest priority for
  // live subscriptions); the next slice becomes WARM. Anything below that
  // is COLD — tracked but not subscribed. This is fire-and-forget; chain
  // resolution & subscribe diff happen on the watcher's own concurrency.
  // Only attach coverage to the response when the watcher is enabled. The
  // UI gates the WS · LIVE/AMBER/EOD badge on `detResult.coverage` being
  // present, so omitting the field keeps non-WS deployments badge-free.
  const coverage: CoverageInfo | null = isWatcherEnabled() ? getCoverageInfo() : null;
  if (isWatcherEnabled()) {
    const ranked = scoredResults.map(r => r.symbol);
    const hot = ranked.slice(0, 30);
    const warm = ranked.slice(30, 80);
    const cold = ranked.slice(80, 200);
    void setWatcherWatchlist({ hot, warm, cold }).catch(err =>
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "watcher.setWatchlist post-scan failed"),
    );
  }

  const result: ScanResult & { allScoredResults?: any[]; weightMode?: string; weightsUsed?: WeightProfile; coverage?: CoverageInfo } = {
    candidates,
    filterSummary: {
      totalScanned: symbols.length,
      passedFilters: scoredResults.length,
      scoredAboveThreshold: aboveThreshold.length,
      filterDetails: filterResults,
    },
    scanTimestamp: Date.now(),
    pulseBias: pulse.bias,
    pulseComposite: pulse.composite,
    pulseConfidence: pulse.confidence,
  };
  result.weightMode = weightMode;
  result.weightsUsed = scanWeights;
  if (coverage) result.coverage = coverage;

  if (options?.returnAll) {
    result.allScoredResults = scoredResults.map(r => ({
      symbol: r.symbol,
      totalScore: r.totalScore,
      setupQuality: r.setupQuality,
      accumulation: r.accumulation,
      ivSetup: r.ivSetup,
      flowDivergence: r.flowDivergence,
      liveFlow: r.liveFlow,
      liveFlowAvailable: r.liveFlowAvailable,
      emergingRS: r.emergingRS,
      rawScores: r.rawScores,
      ivr: r.ivr,
      iv30d: r.iv30d,
      liqScore: r.liqScore,
      atmSpreadPct: r.atmSpreadPct,
      flowDataAvailable: r.flowDataAvailable,
      directionalLean: r.directionalLean,
      price: r.quote.lastPrice,
      changePct: r.quote.netPercentChange,
      sector: getSector(r.symbol),
    }));
  }

  return result;
}
