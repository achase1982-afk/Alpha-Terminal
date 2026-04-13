import { checkEventConflicts } from "./calendarEventChecker.js";
import { emitTelemetry, createTelemetryBatch } from "./telemetryStore.js";
import type { FilterResult, ScanResult, ScanCandidate } from "./deterministicScanner.js";
import { db, equityDailyTable, flowDailyAggregatesTable, optionsFlowPerStrikeTable } from "@workspace/db";
import { desc, eq, inArray, and, gte, lte, sql } from "drizzle-orm";

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

  const perSymbolDates = await db
    .select({
      sym: flowDailyAggregatesTable.underlyingSymbol,
      maxDate: sql<string>`max(${flowDailyAggregatesTable.date})`,
    })
    .from(flowDailyAggregatesTable)
    .where(inArray(flowDailyAggregatesTable.underlyingSymbol, symbols))
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

  emitTelemetry("SCANNER", "INFO", `Discovery scan initiated — ${symbols.length} tickers`, {
    totalTickers: symbols.length, pulseBias: pulse.bias, mode: "DISCOVERY",
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
  const [equityHistoryMap, flowDataMap, dbIvr] = await Promise.all([
    fetchEquityHistoryFromDB(allSymbolsForDB),
    fetchFlowDataFromDB(passedSymbols),
    fetchIvrFromDB(passedSymbols),
  ]);
  emitTelemetry("DATABASE", "INFO", `Scanner: loaded ${equityHistoryMap.size} equity histories, ${flowDataMap.size} flow records, ${dbIvr.currentIvr.size} IVR values from DB`, {
    equitySymbols: equityHistoryMap.size, flowSymbols: flowDataMap.size, ivrSymbols: dbIvr.currentIvr.size,
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
    liqScore: number; flowDataAvailable: boolean;
    directionalLean: "BULLISH" | "BEARISH" | "MIXED";
    quote: { lastPrice: number; totalVolume: number; netPercentChange: number }; candles: Candle[];
    ivr: number; iv30d: number | null; atmSpreadPct: number;
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

      // Earnings flags
      const earningsCheck = checkEventConflicts(sym, 14, "BULL_PUT_SPREAD", null);
      const earningsWithin14d = earningsCheck.eventConflicts.some(e => e.eventType === "earnings");

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

      // ── Category 5 ──
      const { score: s5a, rsSign } = score5A(closes, spyCloses);
      const s5b = score5B(closes, sectorCloses);
      const emergingRS = s5a + s5b;

      // ── Composite ──
      let totalScore: number;
      if (!flowDataAvailable) {
        totalScore = Math.round((setupQuality + accumulation + ivSetup + emergingRS) / 75 * 100);
      } else {
        totalScore = Math.round(setupQuality + accumulation + ivSetup + flowDivergence + emergingRS);
      }

      // ── Directional lean ──
      const directionalLean = computeDirectionalLean(pulseSignal, obvSlopeSign, flowSkewSignal, flowDirSignal, rsSign, flowDataAvailable);

      emitTelemetry("SCANNER", "INFO",
        `${sym} DISCOVERY ${totalScore} — SQ ${setupQuality} ACC ${accumulation} IV ${ivSetup} FLOW ${flowDivergence} RS ${emergingRS} | ${directionalLean}`, {
        ticker: sym, totalScore, setupQuality, accumulation, ivSetup, flowDivergence, emergingRS, directionalLean, flowDataAvailable, pass: totalScore >= CFG.minScore,
      }, "SCANNER", scanBatch);

      scoredResults.push({
        symbol: sym, totalScore,
        rawScores: { s1a, s1b, s1c, s2a, s2b, s2c, s3a, s3b, s3c, s4a, s4b, s4c, s4d, s5a, s5b },
        setupQuality, accumulation, ivSetup, flowDivergence, emergingRS,
        liqScore, flowDataAvailable, directionalLean,
        quote: { lastPrice: spot, totalVolume: quote.totalVolume, netPercentChange: quote.netPercentChange },
        candles, ivr, iv30d, atmSpreadPct,
      });
    } catch (err) {
      log.warn({ symbol: sym, error: err instanceof Error ? err.message : String(err) }, "Discovery: error scoring symbol");
    }
  }

  scoredResults.sort((a, b) => b.totalScore - a.totalScore);
  const aboveThreshold = scoredResults.filter(r => r.totalScore >= CFG.minScore);

  const scoreDistrib = scoredResults.slice(0, 10).map(r => `${r.symbol}=${r.totalScore}(SQ${r.setupQuality}/ACC${r.accumulation}/IV${r.ivSetup}/FL${r.flowDivergence}/RS${r.emergingRS})`);
  log.info({ scored: scoredResults.length, above: aboveThreshold.length, distribution: scoreDistrib }, "Discovery scoring complete");

  const { getUpcomingEvents } = await import("./calendarEventChecker.js");

  const candidates: ScanCandidate[] = aboveThreshold.map(r => {
    const upcoming = getUpcomingEvents(30).filter(e =>
      e.title.toLowerCase().includes(r.symbol.toLowerCase()) || e.importance === "HIGH"
    ).slice(0, 5).map(e => ({ date: e.date, title: e.title, importance: e.importance }));

    const tickerEvents = checkEventConflicts(r.symbol, 30, "BULL_PUT_SPREAD", null);
    const tickerSpecific = tickerEvents.eventConflicts
      .filter(c => c.ticker?.toUpperCase() === r.symbol.toUpperCase())
      .map(c => ({ date: c.date, title: c.eventTitle, importance: c.importance }));

    const allUpcoming = [...tickerSpecific, ...upcoming]
      .filter((v, i, a) => a.findIndex(e => e.date === v.date && e.title === v.title) === i)
      .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 8);

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
      keyStatLabel: r.flowDataAvailable ? "Flow" : "IV Setup",
      keyStatValue: r.flowDataAvailable ? `${r.flowDivergence}/25` : `${r.ivSetup}/25`,
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

  const result: ScanResult & { allScoredResults?: any[] } = {
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

  if (options?.returnAll) {
    result.allScoredResults = scoredResults.map(r => ({
      symbol: r.symbol,
      totalScore: r.totalScore,
      setupQuality: r.setupQuality,
      accumulation: r.accumulation,
      ivSetup: r.ivSetup,
      flowDivergence: r.flowDivergence,
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
