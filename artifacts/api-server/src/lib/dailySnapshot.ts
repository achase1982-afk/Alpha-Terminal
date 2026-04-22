import { db } from "@workspace/db";
import {
  equityDailyTable,
  optionsChainDailyTable,
  optionsFlowPerStrikeTable,
  optionsFlowRawTradesTable,
  flowDailyAggregatesTable,
  referenceDataTable,
  corporateEventsTable,
  snapshotCollectionLogTable,
} from "@workspace/db";
import { eq, sql, and, gte, lte, desc } from "drizzle-orm";
import { logger } from "../lib/logger";
import { logFailure } from "../lib/telemetry";
import { normalizeIV, computeIVRForSymbol } from "./ivNormalize";

const SCHWAB_API = "https://api.schwabapi.com/marketdata/v1";
const POLYGON_API = "https://api.polygon.io";

const SECTOR_ETF_SYMBOLS = ["SPY", "XLK", "XLF", "XLE", "XLV", "XLI", "XLC", "XLY", "XLP", "XLU", "XLRE", "XLB"];

const SECTOR_MAP: Record<string, string> = {
  AAPL:"XLK",MSFT:"XLK",NVDA:"XLK",AMZN:"XLY",META:"XLK",GOOGL:"XLC",GOOG:"XLC",
  TSLA:"XLY",AVGO:"XLK",NFLX:"XLC",AMD:"XLK",CRM:"XLK",ORCL:"XLK",ADBE:"XLK",
  INTU:"XLK",NOW:"XLK",QCOM:"XLK",TXN:"XLK",AMAT:"XLK",MU:"XLK",LRCX:"XLK",
  PANW:"XLK",KLAC:"XLK",SNPS:"XLK",CDNS:"XLK",INTC:"XLK",HPQ:"XLK",DELL:"XLK",
  HPE:"XLK",CSCO:"XLK",
  JPM:"XLF",BAC:"XLF",WFC:"XLF",GS:"XLF",MS:"XLF",SCHW:"XLF",C:"XLF",BLK:"XLF",
  SPGI:"XLF",CME:"XLF",ICE:"XLF",MCO:"XLF",AXP:"XLF",V:"XLF",MA:"XLF",
  CB:"XLF",PGR:"XLF",TRV:"XLF",ALL:"XLF",MET:"XLF",
  UNH:"XLV",LLY:"XLV",ABBV:"XLV",MRK:"XLV",PFE:"XLV",JNJ:"XLV",ABT:"XLV",
  TMO:"XLV",ISRG:"XLV",SYK:"XLV",VRTX:"XLV",REGN:"XLV",AMGN:"XLV",BSX:"XLV",
  HCA:"XLV",DHR:"XLV",ZTS:"XLV",DXCM:"XLV",MDT:"XLV",ELV:"XLV",
  XOM:"XLE",CVX:"XLE",SLB:"XLE",FANG:"XLE",BKR:"XLE",COP:"XLE",EOG:"XLE",
  PG:"XLP",KO:"XLP",PEP:"XLP",COST:"XLP",WMT:"XLP",CL:"XLP",MDLZ:"XLP",PM:"XLP",
  MCD:"XLY",HD:"XLY",LOW:"XLY",TGT:"XLY",SBUX:"XLY",NKE:"XLY",
  DIS:"XLC",CMCSA:"XLC",VZ:"XLC",T:"XLC",TMUS:"XLC",
  NEE:"XLU",DUK:"XLU",SO:"XLU",
  PLD:"XLRE",AMT:"XLRE",EQIX:"XLRE",
  LIN:"XLB",SHW:"XLB",ECL:"XLB",
  CAT:"XLI",HON:"XLI",RTX:"XLI",DE:"XLI",GE:"XLI",UPS:"XLI",FDX:"XLI",NSC:"XLI",UNP:"XLI",
};

interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  datetime: number;
}

interface SchwabQuote {
  lastPrice: number;
  totalVolume: number;
  netPercentChange: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;
  avgVol?: number;
  marketCap?: number;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchWithRetry(url: string, opts: RequestInit, retries = 3): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(20_000) });
      if (res.status === 429 && i < retries) {
        await sleep(15000 * (i + 1));
        continue;
      }
      return res;
    } catch (e) {
      if (i === retries) throw e;
      await sleep(2000 * (i + 1));
    }
  }
  throw new Error("fetch exhausted retries");
}

async function fetchQuotesBatch(
  symbols: string[],
  token: string,
): Promise<Map<string, SchwabQuote>> {
  const map = new Map<string, SchwabQuote>();
  const chunks: string[][] = [];
  for (let i = 0; i < symbols.length; i += 100) chunks.push(symbols.slice(i, i + 100));

  for (const chunk of chunks) {
    try {
      const url = `${SCHWAB_API}/quotes?symbols=${chunk.map(encodeURIComponent).join(",")}&fields=quote,fundamental`;
      const res = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${token}` } });
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
          openPrice: (q["openPrice"] ?? 0) as number,
          highPrice: (q["highPrice"] ?? 0) as number,
          lowPrice: (q["lowPrice"] ?? 0) as number,
          closePrice: (q["closePrice"] ?? q["lastPrice"] ?? 0) as number,
          avgVol: (f?.["avg10DaysVolume"] ?? f?.["avg1YearVolume"]) as number | undefined,
          marketCap: (f?.["marketCap"] ?? f?.["sharesOutstanding"]) as number | undefined,
        });
      }
    } catch (e) {
      logger.warn({ chunk: chunk.slice(0, 3), error: (e as Error).message }, "Snapshot: quote batch failed");
    }
    await sleep(200);
  }
  return map;
}

async function fetchPriceHistory(sym: string, token: string): Promise<Candle[]> {
  try {
    const params = new URLSearchParams({
      symbol: sym,
      periodType: "month",
      period: "3",
      frequencyType: "daily",
      frequency: "1",
      needExtendedHoursData: "false",
    });
    const res = await fetchWithRetry(`${SCHWAB_API}/pricehistory?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const json = await res.json() as { candles?: Array<Record<string, unknown>> };
    return (json.candles ?? []).map(c => ({
      open: c["open"] as number,
      high: c["high"] as number,
      low: c["low"] as number,
      close: c["close"] as number,
      volume: c["volume"] as number,
      datetime: c["datetime"] as number,
    }));
  } catch {
    return [];
  }
}

function computeSMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function computeATR(candles: Candle[], period: number): number | null {
  if (candles.length < period + 1) return null;
  const recent = candles.slice(-(period + 1));
  const trs: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    const h = recent[i].high;
    const l = recent[i].low;
    const pc = recent[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

function computeHV20(closes: number[]): number | null {
  if (closes.length < 21) return null;
  const recent = closes.slice(-21);
  const returns: number[] = [];
  for (let i = 1; i < recent.length; i++) {
    returns.push(Math.log(recent[i] / recent[i - 1]));
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

function computeOBV(candles: Candle[]): number {
  let obv = 0;
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[i - 1].close) obv += candles[i].volume;
    else if (candles[i].close < candles[i - 1].close) obv -= candles[i].volume;
  }
  return obv;
}

function medianOf(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export async function collectEquitySnapshots(
  symbols: string[],
  token: string,
  dateStr?: string,
): Promise<number> {
  const date = dateStr ?? todayStr();
  const allSymbols = [...new Set([...symbols, ...SECTOR_ETF_SYMBOLS])];

  logger.info({ count: allSymbols.length, date }, "Snapshot: collecting equity data");

  const quoteMap = await fetchQuotesBatch(allSymbols, token);
  let rowCount = 0;

  const batchSize = 10;
  for (let i = 0; i < allSymbols.length; i += batchSize) {
    const batch = allSymbols.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async (sym) => {
        const quote = quoteMap.get(sym.toUpperCase());
        const candles = await fetchPriceHistory(sym, token);

        const closes = candles.map(c => c.close);
        const volumes = candles.map(c => c.volume);
        const lastClose = quote?.closePrice ?? quote?.lastPrice ?? closes[closes.length - 1] ?? 0;
        if (lastClose === 0) return;

        const spyQuote = quoteMap.get("SPY");
        const spyClose = spyQuote?.closePrice ?? spyQuote?.lastPrice ?? 0;
        const rsRatio = spyClose > 0 ? lastClose / spyClose : null;

        const sma20 = computeSMA(closes, 20);
        const atr5 = computeATR(candles, 5);
        const atr20 = computeATR(candles, 20);
        const hv20d = computeHV20(closes);
        const obv = computeOBV(candles);

        const vol5 = volumes.length >= 5 ? medianOf(volumes.slice(-5)) : null;
        const vol20 = volumes.length >= 20 ? medianOf(volumes.slice(-20)) : null;

        const pct5d = closes.length >= 6 ? ((closes[closes.length - 1] - closes[closes.length - 6]) / closes[closes.length - 6]) * 100 : null;
        const pct10d = closes.length >= 11 ? ((closes[closes.length - 1] - closes[closes.length - 11]) / closes[closes.length - 11]) * 100 : null;

        await db
          .insert(equityDailyTable)
          .values({
            symbol: sym.toUpperCase(),
            date,
            open: quote?.openPrice ?? candles[candles.length - 1]?.open ?? null,
            high: quote?.highPrice ?? candles[candles.length - 1]?.high ?? null,
            low: quote?.lowPrice ?? candles[candles.length - 1]?.low ?? null,
            close: lastClose,
            adjustedClose: lastClose,
            volume: quote?.totalVolume ?? candles[candles.length - 1]?.volume ?? null,
            marketCap: quote?.marketCap ?? null,
            haltStatus: false,
            ivr: null,
            iv30d: null,
            hv20d: hv20d ?? null,
            putCallRatio: null,
            sma20,
            atr5,
            atr20,
            medianVolume5d: vol5 ? Math.round(vol5) : null,
            medianVolume20d: vol20 ? Math.round(vol20) : null,
            obv,
            rsRatio,
            priceChangePct5d: pct5d,
            priceChangePct10d: pct10d,
          })
          .onConflictDoUpdate({
            target: [equityDailyTable.symbol, equityDailyTable.date],
            set: {
              open: sql`excluded.open`,
              high: sql`excluded.high`,
              low: sql`excluded.low`,
              close: sql`excluded.close`,
              volume: sql`excluded.volume`,
              marketCap: sql`excluded.market_cap`,
              hv20d: sql`excluded.hv_20d`,
              sma20: sql`excluded.sma_20`,
              atr5: sql`excluded.atr_5`,
              atr20: sql`excluded.atr_20`,
              medianVolume5d: sql`excluded.median_volume_5d`,
              medianVolume20d: sql`excluded.median_volume_20d`,
              obv: sql`excluded.obv`,
              rsRatio: sql`excluded.rs_ratio`,
              priceChangePct5d: sql`excluded.price_change_pct_5d`,
              priceChangePct10d: sql`excluded.price_change_pct_10d`,
            },
          });
        rowCount++;
      }),
    );

    for (const r of results) {
      if (r.status === "rejected") {
        logger.warn({ error: (r.reason as Error).message }, "Snapshot: equity row failed");
      }
    }
    await sleep(300);
  }

  void logFailure("DATABASE", "INFO", `equity_daily: ${rowCount} rows upserted`, { table: "equity_daily", rows: rowCount, date });
  logger.info({ rows: rowCount, date }, "Snapshot: equity collection complete");
  return rowCount;
}

export async function collectOptionsChainSnapshots(
  symbols: string[],
  token: string,
  dateStr?: string,
): Promise<number> {
  const date = dateStr ?? todayStr();
  const polygonKey = process.env["POLYGON_API_KEY"];
  let rowCount = 0;

  logger.info({ count: symbols.length, date }, "Snapshot: collecting options chain data");

  for (const sym of symbols) {
    try {
      const quoteRes = await fetchWithRetry(
        `${SCHWAB_API}/quotes?symbols=${encodeURIComponent(sym)}&fields=quote`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      let spot = 0;
      if (quoteRes.ok) {
        const qj = await quoteRes.json() as Record<string, unknown>;
        const q = ((qj[sym] ?? qj[sym.toUpperCase()]) as Record<string, unknown>)?.["quote"] as Record<string, unknown> | undefined;
        spot = (q?.["lastPrice"] ?? q?.["mark"] ?? 0) as number;
      }
      if (spot <= 0) continue;

      const chainRes = await fetchWithRetry(
        `${SCHWAB_API}/chains?symbol=${encodeURIComponent(sym)}&strikeCount=30&includeUnderlyingQuote=false&strategy=SINGLE`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!chainRes.ok) continue;
      const chain = await chainRes.json() as Record<string, unknown>;

      const rows: Array<typeof optionsChainDailyTable.$inferInsert> = [];

      for (const side of ["callExpDateMap", "putExpDateMap"] as const) {
        const optType = side === "callExpDateMap" ? "call" : "put";
        const expMap = chain[side] as Record<string, Record<string, Array<Record<string, unknown>>>> | undefined;
        if (!expMap) continue;

        for (const [expKey, strikes] of Object.entries(expMap)) {
          const expDate = expKey.split(":")[0];
          for (const [strikeStr, contracts] of Object.entries(strikes)) {
            for (const c of contracts) {
              const strike = parseFloat(strikeStr);
              const bid = (c["bid"] ?? 0) as number;
              const ask = (c["ask"] ?? 0) as number;
              rows.push({
                underlyingSymbol: sym.toUpperCase(),
                date,
                optionSymbol: (c["symbol"] as string) ?? null,
                optionType: optType,
                strike,
                expiration: expDate,
                dte: (c["daysToExpiration"] as number) ?? null,
                bid,
                ask,
                mid: (bid + ask) / 2,
                last: (c["last"] ?? null) as number | null,
                volume: (c["totalVolume"] ?? 0) as number,
                openInterest: (c["openInterest"] ?? 0) as number,
                impliedVolatility: normalizeIV((c["volatility"] ?? null) as number | null),
                delta: (c["delta"] ?? null) as number | null,
                gamma: (c["gamma"] ?? null) as number | null,
                theta: (c["theta"] ?? null) as number | null,
                vega: (c["vega"] ?? null) as number | null,
              });
            }
          }
        }
      }

      if (rows.length > 0) {
        const batchSize = 200;
        for (let b = 0; b < rows.length; b += batchSize) {
          const batch = rows.slice(b, b + batchSize);
          await db
            .insert(optionsChainDailyTable)
            .values(batch)
            .onConflictDoNothing();
        }
        rowCount += rows.length;
      }

      const allChainRows = await db
        .select()
        .from(optionsChainDailyTable)
        .where(and(
          eq(optionsChainDailyTable.underlyingSymbol, sym.toUpperCase()),
          eq(optionsChainDailyTable.date, date),
        ));

      if (allChainRows.length > 0) {
        let callVol = 0;
        let putVol = 0;
        for (const c of allChainRows) {
          if (c.optionType === "call") callVol += c.volume ?? 0;
          else putVol += c.volume ?? 0;
        }
        const putCallRatio = callVol > 0 ? putVol / callVol : null;

        const iv30Candidates = allChainRows
          .filter(c => {
            const d = c.dte ?? 0;
            return d >= 20 && d <= 40 && Math.abs(c.strike - spot) / spot <= 0.05 && (c.impliedVolatility ?? 0) > 0;
          })
          .sort((a, b) => Math.abs((a.dte ?? 30) - 30) - Math.abs((b.dte ?? 30) - 30));

        const iv30dRaw = iv30Candidates.length > 0 ? iv30Candidates[0].impliedVolatility : null;
        const iv30d = normalizeIV(iv30dRaw);

        const updates: Record<string, unknown> = {};
        if (putCallRatio != null) updates.putCallRatio = putCallRatio;
        if (iv30d != null) updates.iv30d = iv30d;

        if (Object.keys(updates).length > 0) {
          await db.update(equityDailyTable)
            .set(updates)
            .where(and(eq(equityDailyTable.symbol, sym.toUpperCase()), eq(equityDailyTable.date, date)));
        }
      }

      if (polygonKey && spot > 0) {
        await collectPolygonIVData(sym, polygonKey, spot, token, date);
      }
    } catch (e) {
      logger.warn({ sym, error: (e as Error).message }, "Snapshot: chain collection failed");
    }
    await sleep(500);
  }

  void logFailure("DATABASE", "INFO", `options_chain_daily: ${rowCount} rows upserted`, { table: "options_chain_daily", rows: rowCount, date });
  logger.info({ rows: rowCount, date }, "Snapshot: chain collection complete");
  return rowCount;
}

async function collectPolygonIVData(
  sym: string,
  apiKey: string,
  spot: number,
  _token: string,
  date: string,
): Promise<number> {
  try {
    const strikeMin = Math.floor(spot * 0.8);
    const strikeMax = Math.ceil(spot * 1.2);
    const expMax = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);

    const params = new URLSearchParams({
      expiration_date_gte: date,
      expiration_date_lte: expMax,
      strike_price_gte: String(strikeMin),
      strike_price_lte: String(strikeMax),
      limit: "250",
      apiKey,
    });

    const resp = await fetchWithRetry(
      `${POLYGON_API}/v3/snapshot/options/${encodeURIComponent(sym)}?${params}`,
      {},
    );
    if (!resp.ok) {
      void logFailure("POLYGON_API", "WARN", `IV enrichment HTTP ${resp.status}`, { symbol: sym, status: resp.status, date });
      return 0;
    }
    const json = await resp.json() as { results?: Array<Record<string, unknown>>; status?: string };
    if (json.status !== "OK" || !json.results?.length) return 0;

    let updateCount = 0;
    for (const r of json.results) {
      const details = r["details"] as Record<string, unknown> | undefined;
      if (!details) continue;
      const contractType = details["contract_type"] as string;
      const strikePrice = details["strike_price"] as number;
      const expDate = details["expiration_date"] as string;
      const ivRaw = r["implied_volatility"] as number | undefined;
      const iv = normalizeIV(ivRaw);
      const greeks = r["greeks"] as Record<string, unknown> | undefined;

      if (iv != null) {
        await db.update(optionsChainDailyTable)
          .set({
            impliedVolatility: iv,
            delta: (greeks?.["delta"] as number) ?? null,
            gamma: (greeks?.["gamma"] as number) ?? null,
            theta: (greeks?.["theta"] as number) ?? null,
            vega: (greeks?.["vega"] as number) ?? null,
          })
          .where(and(
            eq(optionsChainDailyTable.underlyingSymbol, sym.toUpperCase()),
            eq(optionsChainDailyTable.date, date),
            eq(optionsChainDailyTable.optionType, contractType === "call" ? "call" : "put"),
            eq(optionsChainDailyTable.strike, strikePrice),
            eq(optionsChainDailyTable.expiration, expDate),
          ));
        updateCount++;
      }
    }
    return updateCount;
  } catch {
    return 0;
  }
}

export async function collectPolygonFlowFromAPI(
  symbols: string[],
  dateStr?: string,
): Promise<{ strikeRows: number; tradeRows: number }> {
  const date = dateStr ?? todayStr();
  const apiKey = process.env["POLYGON_API_KEY"];
  if (!apiKey) return { strikeRows: 0, tradeRows: 0 };

  logger.info({ count: symbols.length, date }, "Snapshot: collecting Polygon flow data");
  void logFailure("POLYGON_API", "INFO", "Flow scan started", { symbols: symbols.length, date });

  let strikeRows = 0;
  let tradeRows = 0;
  let apiCalls = 0;
  let apiErrors = 0;

  const spotCache = new Map<string, number>();
  const equityRows = await db.select({ sym: equityDailyTable.symbol, close: equityDailyTable.close })
    .from(equityDailyTable)
    .where(eq(equityDailyTable.date, date));
  for (const r of equityRows) {
    if (r.close && r.close > 0) spotCache.set(r.sym, r.close);
  }

  for (const sym of symbols) {
    try {
      const spot = spotCache.get(sym.toUpperCase()) ?? 0;
      const expMin = date;
      const expMax = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);

      const passes: Array<{ gte: string; lte: string; strikeMin?: string; strikeMax?: string }> = [
        { gte: expMin, lte: expMax },
      ];

      if (spot > 0) {
        const atmMin3 = Math.floor(spot * 0.97);
        const atmMax3 = Math.ceil(spot * 1.03);
        const dte20 = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
        const dte30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
        passes.push(
          { gte: dte20, lte: expMax, strikeMin: String(atmMin3), strikeMax: String(atmMax3) },
          { gte: dte30, lte: expMax, strikeMin: String(atmMin3), strikeMax: String(atmMax3) },
        );
      }

      const flowRows: Array<typeof optionsFlowPerStrikeTable.$inferInsert> = [];
      const seenKeys = new Set<string>();

      for (const pass of passes) {
        const params = new URLSearchParams({
          expiration_date_gte: pass.gte,
          expiration_date_lte: pass.lte,
          limit: "250",
          apiKey,
        });
        if (pass.strikeMin) params.set("strike_price_gte", pass.strikeMin);
        if (pass.strikeMax) params.set("strike_price_lte", pass.strikeMax);

        apiCalls++;
        const resp = await fetchWithRetry(
          `${POLYGON_API}/v3/snapshot/options/${encodeURIComponent(sym)}?${params}`,
          {},
        );
        if (!resp.ok) {
          apiErrors++;
          void logFailure("POLYGON_API", "WARN", `Options snapshot HTTP ${resp.status}`, { symbol: sym, status: resp.status, date });
          continue;
        }
        const json = await resp.json() as { results?: Array<Record<string, unknown>>; status?: string };
        if (json.status !== "OK" || !json.results?.length) continue;

        for (const r of json.results) {
          const details = r["details"] as Record<string, unknown> | undefined;
          const day = r["day"] as Record<string, unknown> | undefined;
          const lastQuote = r["last_quote"] as Record<string, unknown> | undefined;
          const greeks = r["greeks"] as Record<string, unknown> | undefined;
          if (!details) continue;

          const contractType = (details["contract_type"] as string) === "call" ? "call" : "put";
          const strikePrice = details["strike_price"] as number;
          const expDate = details["expiration_date"] as string;

          const key = `${sym}|${contractType}|${strikePrice}|${expDate}`;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);

          const vol = (day?.["volume"] ?? 0) as number;
          const oi = (r["open_interest"] ?? 0) as number;
          const bid = (lastQuote?.["bid"] ?? 0) as number;
          const ask = (lastQuote?.["ask"] ?? 0) as number;
          const mid = (bid + ask) / 2;

          const nowMs = Date.now();
          const dte = Math.max(0, Math.round((new Date(`${expDate}T20:00:00Z`).getTime() - nowMs) / 86_400_000));

          flowRows.push({
            underlyingSymbol: sym.toUpperCase(),
            date,
            optionType: contractType,
            strike: strikePrice,
            expiration: expDate,
            dte,
            dailyVolume: vol,
            openInterest: oi,
            bid,
            ask,
            mid,
            impliedVolatility: normalizeIV((r["implied_volatility"] as number) ?? null),
            delta: (greeks?.["delta"] as number) ?? null,
            gamma: (greeks?.["gamma"] as number) ?? null,
            theta: (greeks?.["theta"] as number) ?? null,
            vega: (greeks?.["vega"] as number) ?? null,
            avgTradePrice: (day?.["vwap"] as number) ?? mid,
          });
        }
        await sleep(200);
      }

      if (flowRows.length > 0) {
        const batchSize = 200;
        for (let b = 0; b < flowRows.length; b += batchSize) {
          await db.insert(optionsFlowPerStrikeTable).values(flowRows.slice(b, b + batchSize)).onConflictDoNothing();
        }
        strikeRows += flowRows.length;
      }
    } catch (e) {
      apiErrors++;
      logger.warn({ sym, error: (e as Error).message }, "Snapshot: Polygon flow failed");
      void logFailure("POLYGON_API", "WARN", `Flow scan failed for ${sym}`, { symbol: sym, error: (e as Error).message, date });
    }
    await sleep(300);
  }

  const severity = apiErrors > 0 && apiErrors === symbols.length ? "ERROR" : apiErrors > 0 ? "WARN" : "INFO";
  void logFailure("POLYGON_API", severity, `Flow scan complete — ${strikeRows} strikes from ${apiCalls} calls`, {
    strikeRows, tradeRows, apiCalls, apiErrors, date,
    successRate: apiCalls > 0 ? `${Math.round(((apiCalls - apiErrors) / apiCalls) * 100)}%` : "N/A",
  });

  if (strikeRows > 0) {
    void logFailure("DATABASE", "INFO", `options_flow_per_strike: ${strikeRows} rows inserted`, { table: "options_flow_per_strike", rows: strikeRows, date });
  }
  logger.info({ strikeRows, tradeRows, date }, "Snapshot: Polygon flow collection complete");
  return { strikeRows, tradeRows };
}

export async function computeFlowAggregates(
  symbols: string[],
  dateStr?: string,
): Promise<number> {
  const date = dateStr ?? todayStr();
  let count = 0;

  logger.info({ count: symbols.length, date }, "Snapshot: computing flow aggregates");

  for (const sym of symbols) {
    try {
      const strikes = await db
        .select()
        .from(optionsFlowPerStrikeTable)
        .where(and(
          eq(optionsFlowPerStrikeTable.underlyingSymbol, sym.toUpperCase()),
          eq(optionsFlowPerStrikeTable.date, date),
        ));

      if (strikes.length === 0) continue;

      const equityRow = await db
        .select()
        .from(equityDailyTable)
        .where(and(
          eq(equityDailyTable.symbol, sym.toUpperCase()),
          eq(equityDailyTable.date, date),
        ))
        .limit(1);

      const spotClose = equityRow[0]?.close ?? 0;

      const hasOiData = strikes.some(s => s.openInterest != null && s.openInterest > 0);
      const qualifying = strikes.filter(s => {
        const vol = s.dailyVolume ?? 0;
        if (vol < 1) return false;
        if (spotClose <= 0) return hasOiData ? (s.openInterest ?? 0) >= 200 : true;
        const strikePct = Math.abs(s.strike - spotClose) / spotClose;
        const inRange = strikePct <= 0.2 && (s.dte ?? 999) <= 60;
        return inRange && (hasOiData ? (s.openInterest ?? 0) >= 200 : true);
      });

      let totalCallVol = 0;
      let totalPutVol = 0;
      let totalOi = 0;
      let totalNotional = 0;
      let weightedVolOiNum = 0;
      let weightedVolOiDen = 0;

      for (const s of qualifying) {
        const vol = s.dailyVolume ?? 0;
        const oi = s.openInterest ?? 0;
        const mid = s.mid ?? 0;
        const notional = vol * mid * 100;

        if (s.optionType === "call") totalCallVol += vol;
        else totalPutVol += vol;

        totalOi += oi;
        totalNotional += notional;

        if (oi >= 200 && vol > 0) {
          const voiRatio = vol / oi;
          weightedVolOiNum += voiRatio * notional;
          weightedVolOiDen += notional;
        }
      }

      const totalVol = totalCallVol + totalPutVol;
      const pcSkew = totalVol > 0 ? Math.abs(totalCallVol - totalPutVol) / totalVol : 0;
      const avgVolOiRatio = weightedVolOiDen > 0 ? weightedVolOiNum / weightedVolOiDen : 0;

      let flowDirection: string = "NEUTRAL";
      if (totalCallVol > 1.5 * totalPutVol) flowDirection = "BULLISH";
      else if (totalPutVol > 1.5 * totalCallVol) flowDirection = "BEARISH";

      const past20 = await db
        .select({ notional: flowDailyAggregatesTable.totalOptionsNotional })
        .from(flowDailyAggregatesTable)
        .where(and(
          eq(flowDailyAggregatesTable.underlyingSymbol, sym.toUpperCase()),
          sql`${flowDailyAggregatesTable.date} < ${date}`,
        ))
        .orderBy(desc(flowDailyAggregatesTable.date))
        .limit(20);

      const pastNotionals = past20.map(r => r.notional ?? 0).filter(n => n > 0);
      const avgNotional20d = pastNotionals.length > 0
        ? pastNotionals.reduce((a, b) => a + b, 0) / pastNotionals.length
        : 0;

      const blockThreshold = avgNotional20d > 0 ? avgNotional20d * 0.005 : totalNotional * 0.005;
      let blockCount = 0;
      let blockNotionalTotal = 0;

      for (const s of qualifying) {
        const vol = s.dailyVolume ?? 0;
        const mid = s.mid ?? 0;
        const notional = vol * mid * 100;
        if (notional > blockThreshold && vol > 500) {
          blockCount++;
          blockNotionalTotal += notional;
        }
      }

      await db
        .insert(flowDailyAggregatesTable)
        .values({
          underlyingSymbol: sym.toUpperCase(),
          date,
          totalCallVolume: totalCallVol,
          totalPutVolume: totalPutVol,
          totalOi,
          totalOptionsNotional: totalNotional,
          avgVolOiRatio,
          pcSkew,
          blockCount,
          blockNotionalTotal,
          avgDailyOptionsNotional20d: avgNotional20d,
          flowDirection,
          numSweeps: 0,
        })
        .onConflictDoUpdate({
          target: [flowDailyAggregatesTable.underlyingSymbol, flowDailyAggregatesTable.date],
          set: {
            totalCallVolume: sql`excluded.total_call_volume`,
            totalPutVolume: sql`excluded.total_put_volume`,
            totalOi: sql`excluded.total_oi`,
            totalOptionsNotional: sql`excluded.total_options_notional`,
            avgVolOiRatio: sql`excluded.avg_vol_oi_ratio`,
            pcSkew: sql`excluded.pc_skew`,
            blockCount: sql`excluded.block_count`,
            blockNotionalTotal: sql`excluded.block_notional_total`,
            avgDailyOptionsNotional20d: sql`excluded.avg_daily_options_notional_20d`,
            flowDirection: sql`excluded.flow_direction`,
            numSweeps: sql`excluded.num_sweeps`,
          },
        });
      count++;
    } catch (e) {
      logger.warn({ sym, error: (e as Error).message }, "Snapshot: aggregate computation failed");
    }
  }

  if (count > 0) {
    void logFailure("DATABASE", "INFO", `flow_daily_aggregates: ${count} rows upserted`, { table: "flow_daily_aggregates", rows: count, date });
  }
  logger.info({ count, date }, "Snapshot: flow aggregates complete");
  return count;
}

export async function computeIVFromFlow(
  symbols: string[],
  dateStr?: string,
): Promise<number> {
  const date = dateStr ?? todayStr();
  let updated = 0;

  const flowDateCandidates = await db
    .select({ d: sql<string>`DISTINCT ${optionsFlowPerStrikeTable.date}` })
    .from(optionsFlowPerStrikeTable)
    .where(sql`${optionsFlowPerStrikeTable.impliedVolatility} IS NOT NULL AND ${optionsFlowPerStrikeTable.impliedVolatility} > 0`)
    .orderBy(sql`${optionsFlowPerStrikeTable.date} DESC`)
    .limit(5);
  const flowDatesWithIV = flowDateCandidates.map(r => r.d);

  for (const sym of symbols) {
    try {
      const equityRow = await db
        .select()
        .from(equityDailyTable)
        .where(and(eq(equityDailyTable.symbol, sym.toUpperCase()), eq(equityDailyTable.date, date)))
        .limit(1);
      if (equityRow.length === 0) continue;
      const spot = equityRow[0].close ?? 0;
      if (spot <= 0) continue;

      // Strict: only use today's flow data. Never borrow from another date.
      const ivStrikes = await db
        .select()
        .from(optionsFlowPerStrikeTable)
        .where(and(
          eq(optionsFlowPerStrikeTable.underlyingSymbol, sym.toUpperCase()),
          eq(optionsFlowPerStrikeTable.date, date),
        ));

      let iv30d: number | null = null;
      if (ivStrikes.length > 0) {
        const iv30Candidates = ivStrikes
          .filter(s => {
            const d = s.dte ?? 0;
            const v = normalizeIV(s.impliedVolatility);
            return v != null
              && d >= 1 && d <= 60
              && Math.abs(s.strike - spot) / spot <= 0.10;
          })
          .sort((a, b) => {
            const aScore = Math.abs((a.dte ?? 30) - 30) + Math.abs(a.strike - spot) / spot * 100;
            const bScore = Math.abs((b.dte ?? 30) - 30) + Math.abs(b.strike - spot) / spot * 100;
            return aScore - bScore;
          });
        if (iv30Candidates.length > 0) {
          iv30d = normalizeIV(iv30Candidates[0].impliedVolatility);
        }
      }

      let putCallRatio: number | null = null;
      if (ivStrikes.length > 0) {
        const totalCallVol = ivStrikes.filter(s => s.optionType === "call").reduce((a, s) => a + (s.dailyVolume ?? 0), 0);
        const totalPutVol = ivStrikes.filter(s => s.optionType === "put").reduce((a, s) => a + (s.dailyVolume ?? 0), 0);
        putCallRatio = totalCallVol > 0 ? totalPutVol / totalCallVol : null;
      }

      // Compose update: only write iv30d if we computed one this run; otherwise leave any
      // previously-written value (e.g. from chain pass) alone. Same for putCallRatio.
      const updates: Record<string, unknown> = {};
      if (iv30d != null) updates.iv30d = iv30d;
      if (putCallRatio != null) updates.putCallRatio = putCallRatio;
      if (Object.keys(updates).length > 0) {
        await db.update(equityDailyTable)
          .set(updates)
          .where(and(eq(equityDailyTable.symbol, sym.toUpperCase()), eq(equityDailyTable.date, date)));
      }

      // IVR — read whatever iv30d ended up in equity_daily (chain or flow), then percentile
      // against history with clamping to [0,100].
      const ivr = await computeIVRForSymbol(sym, date, iv30d);
      if (ivr != null) {
        await db.update(equityDailyTable)
          .set({ ivr })
          .where(and(eq(equityDailyTable.symbol, sym.toUpperCase()), eq(equityDailyTable.date, date)));
      }

      updated++;
    } catch (e) {
      logger.warn({ sym, error: (e as Error).message }, "Snapshot: IV computation failed");
    }
  }

  if (updated > 0) {
    void logFailure("DATABASE", "INFO", `IV30d computed for ${updated} symbols`, { updated, date });
  }
  logger.info({ updated, date }, "Snapshot: IV computation complete");
  return updated;
}

export async function populateReferenceData(symbols: string[]): Promise<number> {
  let count = 0;
  for (const sym of symbols) {
    const sectorEtf = SECTOR_MAP[sym.toUpperCase()] ?? null;
    await db
      .insert(referenceDataTable)
      .values({ symbol: sym.toUpperCase(), sectorEtf, isAdr: false, ipoDate: null })
      .onConflictDoUpdate({
        target: referenceDataTable.symbol,
        set: { sectorEtf: sql`excluded.sector_etf` },
      });
    count++;
  }
  return count;
}

// Hard upper bound on a single snapshot run. The 2026-04-17 stuck row hung
// for hours with status='running', errorMsg=NULL — meaning runFullSnapshot
// was invoked but neither finished nor threw. With this wrapper, a hung
// inner await will time out, the snapshot row will be marked 'failed', and
// the next IVR recompute won't see a phantom in-flight row.
const SNAPSHOT_HARD_TIMEOUT_MS = 45 * 60 * 1000;

// Any snapshot row still 'running' after this many hours since startedAt is
// considered orphaned (process killed mid-run, exit handler never fired).
// Startup sweep marks them 'failed' so the next attempt can re-run.
const SNAPSHOT_STALE_HOURS = 6;

/**
 * Mark any snapshot_collection_log rows still in 'running' state past the
 * staleness threshold as 'failed'. Called once at server startup so a
 * SIGKILL during a snapshot can't leave a phantom 'running' row that blocks
 * future runs or hides IV gaps.
 */
export async function sweepStaleSnapshots(): Promise<{ swept: number }> {
  const result = await db.execute(sql`
    UPDATE snapshot_collection_log
    SET status = 'failed',
        error_msg = 'auto-recovered: stale running row (process likely killed mid-run)',
        completed_at = now()
    WHERE status = 'running'
      AND started_at < (now() - (${SNAPSHOT_STALE_HOURS}::int * interval '1 hour'))
  `);
  const swept = (result as { rowCount?: number }).rowCount ?? 0;
  if (swept > 0) {
    logger.warn({ swept, staleHours: SNAPSHOT_STALE_HOURS }, "sweepStaleSnapshots: recovered orphaned 'running' rows");
    void logFailure("DATABASE", "WARN", `Recovered ${swept} stale snapshot(s)`, { swept, staleHours: SNAPSHOT_STALE_HOURS });
  } else {
    logger.info("sweepStaleSnapshots: no orphaned snapshots to recover");
  }
  return { swept };
}

export async function runFullSnapshot(
  symbols: string[],
  token: string,
  dateStr?: string,
): Promise<{ equityRows: number; chainRows: number; flowRows: number; aggregateRows: number }> {
  const date = dateStr ?? todayStr();

  await db.insert(snapshotCollectionLogTable)
    .values({ date, status: "running" })
    .onConflictDoUpdate({
      target: snapshotCollectionLogTable.date,
      set: { status: sql`'running'`, startedAt: sql`now()`, errorMsg: sql`null` },
    });

  // Wrap the entire run in a hard timeout race. Without this, an inner await
  // that hangs (Schwab/Polygon socket without its own timeout, etc.) leaves
  // the row stuck in 'running' forever. With it, after 45 min the row gets
  // marked 'failed' and the next scheduled run can attempt again.
  //
  // CAVEAT: Promise.race does NOT cancel the inner pipeline. After timeout
  // the snapshot_collection_log row is marked 'failed' and a fresh run can
  // start, but the original collectEquitySnapshots / collectOptionsChainSnapshots
  // / collectPolygonFlowFromAPI / computeFlowAggregates / computeIVFromFlow
  // chain may continue running in the background, consuming Schwab + Polygon
  // quota and DB connections. Writes are PK-upserts so no corruption, but
  // resource overlap with the next run is possible. The proper fix is
  // socket-level AbortController on each fetch — this wrapper is a belt-and-
  // suspenders so the row state never gets permanently wedged.
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`runFullSnapshot timed out after ${SNAPSHOT_HARD_TIMEOUT_MS / 60000} min`)),
      SNAPSHOT_HARD_TIMEOUT_MS,
    );
  });

  try {
    const result = await Promise.race([
      (async () => {
        await populateReferenceData(symbols);

        const equityRows = await collectEquitySnapshots(symbols, token, date);

        const chainRows = await collectOptionsChainSnapshots(symbols, token, date);

        const { strikeRows: flowRows } = await collectPolygonFlowFromAPI(symbols, date);

        const aggregateRows = await computeFlowAggregates(symbols, date);

        // Include sector ETFs in the IV/IVR pass — they get equity rows from collectEquitySnapshots
        // but were previously excluded from IVR computation.
        const ivSymbols = [...new Set([...symbols, ...SECTOR_ETF_SYMBOLS])];
        const ivRows = await computeIVFromFlow(ivSymbols, date);
        void ivRows;

        return { equityRows, chainRows, flowRows, aggregateRows };
      })(),
      timeoutPromise,
    ]);

    if (timer) clearTimeout(timer);

    await db.update(snapshotCollectionLogTable)
      .set({
        status: "completed",
        equityRows: result.equityRows,
        chainRows: result.chainRows,
        flowRows: result.flowRows,
        aggregateRows: result.aggregateRows,
        completedAt: new Date(),
      })
      .where(eq(snapshotCollectionLogTable.date, date));

    void logFailure("POLYGON_API", "INFO", "Full snapshot complete", { ...result, date });
    logger.info({ ...result, date }, "Snapshot: full collection complete");
    return result;
  } catch (e) {
    if (timer) clearTimeout(timer);
    const msg = (e as Error).message;
    await db.update(snapshotCollectionLogTable)
      .set({ status: "failed", errorMsg: msg, completedAt: new Date() })
      .where(eq(snapshotCollectionLogTable.date, date));
    void logFailure("POLYGON_API", "ERROR", "Full snapshot failed", { error: msg, date });
    logger.error({ error: msg, date }, "Snapshot: full collection failed");
    throw e;
  }
}

export async function backfillEquityHistory(
  symbols: string[],
  token: string,
): Promise<{ totalRows: number; symbolsDone: number; tradingDays: number }> {
  const allSymbols = [...new Set([...symbols, ...SECTOR_ETF_SYMBOLS])];
  logger.info({ count: allSymbols.length }, "Backfill: starting equity history backfill");
  void logFailure("DATABASE", "INFO", `Backfill started — ${allSymbols.length} symbols`, { symbols: allSymbols.length });

  const spyCandles = await fetchPriceHistory("SPY", token);
  const spyCloses = spyCandles.map(c => c.close);

  const sectorHistories = new Map<string, Candle[]>();
  for (const etf of SECTOR_ETF_SYMBOLS) {
    const c = await fetchPriceHistory(etf, token);
    if (c.length > 0) sectorHistories.set(etf, c);
    await sleep(200);
  }

  let totalRows = 0;
  let symbolsDone = 0;
  let tradingDays = 0;

  for (const sym of allSymbols) {
    try {
      const candles = await fetchPriceHistory(sym, token);
      if (candles.length < 5) {
        logger.warn({ sym, candleCount: candles.length }, "Backfill: insufficient candles, skipping");
        continue;
      }

      const sectorEtf = SECTOR_MAP[sym.toUpperCase()] ?? "SPY";
      const sectorCandles = sectorHistories.get(sectorEtf) ?? sectorHistories.get("SPY") ?? spyCandles;
      const sectorCloses = sectorCandles.map(c => c.close);

      const rows: Array<typeof equityDailyTable.$inferInsert> = [];

      for (let dayIdx = 0; dayIdx < candles.length; dayIdx++) {
        const c = candles[dayIdx];
        const dateStr = new Date(c.datetime).toISOString().slice(0, 10);
        const closesUpTo = candles.slice(0, dayIdx + 1).map(x => x.close);
        const candlesUpTo = candles.slice(0, dayIdx + 1);
        const volumesUpTo = candles.slice(0, dayIdx + 1).map(x => x.volume);

        const sma20 = computeSMA(closesUpTo, 20);
        const atr5 = computeATR(candlesUpTo, 5);
        const atr20 = computeATR(candlesUpTo, 20);
        const hv20d = computeHV20(closesUpTo);
        const obv = computeOBV(candlesUpTo);

        const vol5 = volumesUpTo.length >= 5 ? medianOf(volumesUpTo.slice(-5)) : null;
        const vol20 = volumesUpTo.length >= 20 ? medianOf(volumesUpTo.slice(-20)) : null;

        let rsRatio: number | null = null;
        if (spyCloses.length > 20 && closesUpTo.length > 20) {
          const stockPct = (closesUpTo[closesUpTo.length - 1] - closesUpTo[closesUpTo.length - 21]) / closesUpTo[closesUpTo.length - 21];
          const spyEndIdx = Math.min(dayIdx, spyCloses.length - 1);
          const spyStartIdx = Math.max(0, spyEndIdx - 20);
          if (spyCloses[spyStartIdx] > 0) {
            const spyPct = (spyCloses[spyEndIdx] - spyCloses[spyStartIdx]) / spyCloses[spyStartIdx];
            rsRatio = spyPct !== 0 ? stockPct / spyPct : null;
          }
        }

        const pct5d = closesUpTo.length > 5 ? ((closesUpTo[closesUpTo.length - 1] - closesUpTo[closesUpTo.length - 6]) / closesUpTo[closesUpTo.length - 6]) * 100 : null;
        const pct10d = closesUpTo.length > 10 ? ((closesUpTo[closesUpTo.length - 1] - closesUpTo[closesUpTo.length - 11]) / closesUpTo[closesUpTo.length - 11]) * 100 : null;

        rows.push({
          symbol: sym.toUpperCase(),
          date: dateStr,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          adjustedClose: c.close,
          volume: c.volume,
          marketCap: null,
          haltStatus: false,
          ivr: null,
          iv30d: null,
          hv20d: hv20d ?? null,
          putCallRatio: null,
          sma20,
          atr5,
          atr20,
          medianVolume5d: vol5 ? Math.round(vol5) : null,
          medianVolume20d: vol20 ? Math.round(vol20) : null,
          obv,
          rsRatio,
          priceChangePct5d: pct5d,
          priceChangePct10d: pct10d,
        });
      }

      if (rows.length > 0) {
        tradingDays = Math.max(tradingDays, rows.length);
        const batchSize = 50;
        for (let b = 0; b < rows.length; b += batchSize) {
          await db.insert(equityDailyTable)
            .values(rows.slice(b, b + batchSize))
            .onConflictDoUpdate({
              target: [equityDailyTable.symbol, equityDailyTable.date],
              set: {
                open: sql`excluded.open`,
                high: sql`excluded.high`,
                low: sql`excluded.low`,
                close: sql`excluded.close`,
                volume: sql`excluded.volume`,
                hv20d: sql`excluded.hv_20d`,
                sma20: sql`excluded.sma_20`,
                atr5: sql`excluded.atr_5`,
                atr20: sql`excluded.atr_20`,
                medianVolume5d: sql`excluded.median_volume_5d`,
                medianVolume20d: sql`excluded.median_volume_20d`,
                obv: sql`excluded.obv`,
                rsRatio: sql`excluded.rs_ratio`,
                priceChangePct5d: sql`excluded.price_change_pct_5d`,
                priceChangePct10d: sql`excluded.price_change_pct_10d`,
              },
            });
        }
        totalRows += rows.length;
        symbolsDone++;
      }
    } catch (e) {
      logger.warn({ sym, error: (e as Error).message }, "Backfill: symbol failed");
    }
    await sleep(300);

    if (symbolsDone % 10 === 0 && symbolsDone > 0) {
      void logFailure("DATABASE", "INFO", `Backfill progress: ${symbolsDone}/${allSymbols.length} symbols, ${totalRows} rows`, {
        symbolsDone, totalSymbols: allSymbols.length, totalRows,
      });
    }
  }

  void logFailure("DATABASE", "INFO", `Backfill complete — ${totalRows} rows across ${symbolsDone} symbols, ~${tradingDays} trading days`, {
    totalRows, symbolsDone, tradingDays,
  });
  logger.info({ totalRows, symbolsDone, tradingDays }, "Backfill: equity history complete");
  return { totalRows, symbolsDone, tradingDays };
}

export async function backfillPolygonFlow(
  symbols: string[],
  daysBack = 60,
  force = false,
): Promise<{ totalStrikeRows: number; symbolsDone: number; datesProcessed: number; skipped: number }> {
  const apiKey = process.env["POLYGON_API_KEY"];
  if (!apiKey) {
    logger.warn("Backfill: no POLYGON_API_KEY, skipping flow backfill");
    return { totalStrikeRows: 0, symbolsDone: 0, datesProcessed: 0, skipped: 0 };
  }

  let needsBackfill: string[];
  let skipped: number;

  if (force) {
    needsBackfill = symbols;
    skipped = 0;
  } else {
    const existingCounts = await db
      .select({
        sym: optionsFlowPerStrikeTable.underlyingSymbol,
        dateCnt: sql<number>`COUNT(DISTINCT ${optionsFlowPerStrikeTable.date})`,
      })
      .from(optionsFlowPerStrikeTable)
      .where(lte(optionsFlowPerStrikeTable.date, new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10)))
      .groupBy(optionsFlowPerStrikeTable.underlyingSymbol);
    const countMap = new Map(existingCounts.map(r => [r.sym, Number(r.dateCnt)]));
    needsBackfill = symbols.filter(s => (countMap.get(s.toUpperCase()) ?? 0) < 20);
    skipped = symbols.length - needsBackfill.length;
  }

  logger.info({ total: symbols.length, needsBackfill: needsBackfill.length, skipped, daysBack }, "Backfill: starting Polygon flow (resumable)");
  void logFailure("POLYGON_API", "INFO", `Flow backfill started — ${needsBackfill.length} symbols need data (${skipped} already done), ${daysBack} days`, { needsBackfill: needsBackfill.length, skipped, daysBack });

  if (needsBackfill.length === 0) {
    return { totalStrikeRows: 0, symbolsDone: 0, datesProcessed: 0, skipped };
  }

  const now = new Date();
  const fromDate = new Date(now.getTime() - daysBack * 86_400_000).toISOString().slice(0, 10);
  const toDate = now.toISOString().slice(0, 10);

  let totalStrikeRows = 0;
  let symbolsDone = 0;
  const allDates = new Set<string>();
  const PARALLEL_CONTRACTS = 5;

  for (const sym of needsBackfill) {
    try {
      const contractsUrl = `${POLYGON_API}/v3/reference/options/contracts?underlying_ticker=${encodeURIComponent(sym)}&expiration_date.gte=${fromDate}&limit=250&apiKey=${apiKey}`;
      const contractsResp = await fetchWithRetry(contractsUrl, {});
      if (!contractsResp.ok) {
        logger.warn({ sym, status: contractsResp.status }, "Backfill: contracts listing failed");
        continue;
      }
      const contractsJson = await contractsResp.json() as { results?: Array<Record<string, unknown>> };
      const contracts = contractsJson.results ?? [];
      if (contracts.length === 0) continue;

      const allRows: Array<typeof optionsFlowPerStrikeTable.$inferInsert> = [];

      for (let ci = 0; ci < contracts.length; ci += PARALLEL_CONTRACTS) {
        const batch = contracts.slice(ci, ci + PARALLEL_CONTRACTS);
        const results = await Promise.allSettled(batch.map(async (contract) => {
          const ticker = contract["ticker"] as string | undefined;
          const contractType = contract["contract_type"] as string | undefined;
          const strikePrice = contract["strike_price"] as number | undefined;
          const expDate = contract["expiration_date"] as string | undefined;
          if (!ticker || !contractType || !strikePrice || !expDate) return [];

          const aggsUrl = `${POLYGON_API}/v2/aggs/ticker/${encodeURIComponent(ticker)}/range/1/day/${fromDate}/${toDate}?adjusted=true&sort=asc&limit=120&apiKey=${apiKey}`;
          const aggsResp = await fetchWithRetry(aggsUrl, {});
          if (!aggsResp.ok) return [];
          const aggsJson = await aggsResp.json() as { results?: Array<Record<string, unknown>> };
          const bars = aggsJson.results ?? [];
          const rows: Array<typeof optionsFlowPerStrikeTable.$inferInsert> = [];

          for (const bar of bars) {
            const ts = bar["t"] as number;
            const dateStr = new Date(ts).toISOString().slice(0, 10);
            const vol = (bar["v"] ?? 0) as number;
            const vwap = (bar["vw"] ?? 0) as number;
            const barClose = (bar["c"] ?? 0) as number;
            if (vol < 1) continue;
            const dte = Math.max(0, Math.round((new Date(`${expDate}T20:00:00Z`).getTime() - new Date(`${dateStr}T20:00:00Z`).getTime()) / 86_400_000));
            rows.push({
              underlyingSymbol: sym.toUpperCase(),
              date: dateStr,
              optionType: contractType === "call" ? "call" : "put",
              strike: strikePrice,
              expiration: expDate,
              dte,
              dailyVolume: Math.round(vol),
              openInterest: null,
              bid: null,
              ask: null,
              mid: barClose > 0 ? barClose : null,
              impliedVolatility: null,
              delta: null,
              gamma: null,
              theta: null,
              vega: null,
              avgTradePrice: vwap > 0 ? vwap : null,
            });
          }
          return rows;
        }));

        for (const r of results) {
          if (r.status === "fulfilled") {
            for (const row of r.value) {
              allDates.add(row.date!);
            }
            allRows.push(...r.value);
          }
        }
        await sleep(80);
      }

      if (allRows.length > 0) {
        const batchSize = 500;
        for (let b = 0; b < allRows.length; b += batchSize) {
          await db.insert(optionsFlowPerStrikeTable)
            .values(allRows.slice(b, b + batchSize))
            .onConflictDoNothing();
        }
      }

      totalStrikeRows += allRows.length;
      symbolsDone++;

      logger.info({ sym, symbolsDone, totalSymbols: needsBackfill.length, rows: allRows.length, totalStrikeRows }, "Backfill: symbol done");

      if (symbolsDone % 5 === 0) {
        void logFailure("POLYGON_API", "INFO", `Flow backfill progress: ${symbolsDone}/${needsBackfill.length} symbols, ${totalStrikeRows} strike rows`, {
          symbolsDone, totalSymbols: needsBackfill.length, totalStrikeRows,
        });
      }
    } catch (e) {
      logger.warn({ sym, error: (e as Error).message }, "Backfill: Polygon flow symbol failed");
    }
    await sleep(100);
  }

  const datesProcessed = allDates.size;

  if (datesProcessed > 0) {
    logger.info({ symbols: needsBackfill.length, datesProcessed }, "Backfill: computing flow aggregates for historical dates");
    const sortedDates = [...allDates].sort();
    for (const d of sortedDates) {
      await computeFlowAggregates(symbols, d);
    }
  }

  void logFailure("DATABASE", "INFO", `Flow backfill complete — ${totalStrikeRows} strike rows across ${symbolsDone} symbols, ${datesProcessed} dates`, {
    totalStrikeRows, symbolsDone, datesProcessed,
  });
  logger.info({ totalStrikeRows, symbolsDone, datesProcessed, skipped }, "Backfill: Polygon flow history complete");
  return { totalStrikeRows, symbolsDone, datesProcessed, skipped };
}

export async function backfillEquityFromPolygon(
  symbols: string[],
  daysBack = 120,
): Promise<{ totalRows: number; symbolsDone: number }> {
  const apiKey = process.env["POLYGON_API_KEY"];
  if (!apiKey) return { totalRows: 0, symbolsDone: 0 };

  const fromDate = new Date(Date.now() - daysBack * 86_400_000).toISOString().slice(0, 10);
  const toDate = new Date().toISOString().slice(0, 10);

  const spyUrl = `${POLYGON_API}/v2/aggs/ticker/SPY/range/1/day/${fromDate}/${toDate}?adjusted=true&sort=asc&limit=250&apiKey=${apiKey}`;
  let spyCloses: number[] = [];
  try {
    const spyResp = await fetchWithRetry(spyUrl, {});
    if (spyResp.ok) {
      const spyJson = await spyResp.json() as { results?: Array<Record<string, unknown>> };
      spyCloses = (spyJson.results ?? []).map(b => (b["c"] as number) ?? 0);
    } else {
      logger.warn({ status: spyResp.status }, "PolygonEquityBackfill: SPY fetch failed, RS ratio will be null");
    }
  } catch (e) {
    logger.warn({ error: (e as Error).message }, "PolygonEquityBackfill: SPY fetch error, RS ratio will be null");
  }

  let totalRows = 0;
  let symbolsDone = 0;

  for (const sym of symbols) {
    try {
      const url = `${POLYGON_API}/v2/aggs/ticker/${encodeURIComponent(sym)}/range/1/day/${fromDate}/${toDate}?adjusted=true&sort=asc&limit=250&apiKey=${apiKey}`;
      const resp = await fetchWithRetry(url, {});
      if (!resp.ok) { logger.warn({ sym, status: resp.status }, "PolygonEquityBackfill: failed"); continue; }
      const json = await resp.json() as { results?: Array<Record<string, unknown>> };
      const bars = json.results ?? [];
      if (bars.length < 5) continue;

      const sectorEtf = SECTOR_MAP[sym.toUpperCase()] ?? "SPY";
      let sectorCloses = spyCloses;
      if (sectorEtf !== "SPY") {
        const sUrl = `${POLYGON_API}/v2/aggs/ticker/${sectorEtf}/range/1/day/${fromDate}/${toDate}?adjusted=true&sort=asc&limit=250&apiKey=${apiKey}`;
        const sResp = await fetchWithRetry(sUrl, {});
        if (sResp.ok) {
          const sJson = await sResp.json() as { results?: Array<Record<string, unknown>> };
          sectorCloses = (sJson.results ?? []).map(b => (b["c"] as number) ?? 0);
        }
      }

      const rows: Array<typeof equityDailyTable.$inferInsert> = [];

      for (let i = 0; i < bars.length; i++) {
        const b = bars[i];
        const ts = b["t"] as number;
        const dateStr = new Date(ts).toISOString().slice(0, 10);
        const open = (b["o"] as number) ?? 0;
        const high = (b["h"] as number) ?? 0;
        const low = (b["l"] as number) ?? 0;
        const close = (b["c"] as number) ?? 0;
        const volume = (b["v"] as number) ?? 0;
        if (close <= 0) continue;

        const closesUpTo = bars.slice(0, i + 1).map(x => (x["c"] as number) ?? 0);
        const candlesUpTo = bars.slice(0, i + 1).map(x => ({
          open: (x["o"] as number) ?? 0,
          high: (x["h"] as number) ?? 0,
          low: (x["l"] as number) ?? 0,
          close: (x["c"] as number) ?? 0,
          volume: (x["v"] as number) ?? 0,
          datetime: (x["t"] as number) ?? 0,
        }));
        const volumesUpTo = bars.slice(0, i + 1).map(x => (x["v"] as number) ?? 0);

        const sma20 = computeSMA(closesUpTo, 20);
        const atr5 = computeATR(candlesUpTo, 5);
        const atr20 = computeATR(candlesUpTo, 20);
        const hv20d = computeHV20(closesUpTo);
        const obv = computeOBV(candlesUpTo);
        const vol5 = volumesUpTo.length >= 5 ? medianOf(volumesUpTo.slice(-5)) : null;
        const vol20 = volumesUpTo.length >= 20 ? medianOf(volumesUpTo.slice(-20)) : null;

        let rsRatio: number | null = null;
        if (spyCloses.length > 20 && closesUpTo.length > 20) {
          const stockPct = (closesUpTo[closesUpTo.length - 1] - closesUpTo[closesUpTo.length - 21]) / closesUpTo[closesUpTo.length - 21];
          const spyEndIdx = Math.min(i, spyCloses.length - 1);
          const spyStartIdx = Math.max(0, spyEndIdx - 20);
          if (spyCloses[spyStartIdx] > 0) {
            const spyPct = (spyCloses[spyEndIdx] - spyCloses[spyStartIdx]) / spyCloses[spyStartIdx];
            rsRatio = spyPct !== 0 ? stockPct / spyPct : null;
          }
        }

        const pct5d = closesUpTo.length > 5 ? ((closesUpTo[closesUpTo.length - 1] - closesUpTo[closesUpTo.length - 6]) / closesUpTo[closesUpTo.length - 6]) * 100 : null;
        const pct10d = closesUpTo.length > 10 ? ((closesUpTo[closesUpTo.length - 1] - closesUpTo[closesUpTo.length - 11]) / closesUpTo[closesUpTo.length - 11]) * 100 : null;

        rows.push({
          symbol: sym.toUpperCase(),
          date: dateStr,
          open, high, low, close,
          adjustedClose: close,
          volume: Math.round(volume),
          marketCap: null,
          haltStatus: false,
          ivr: null, iv30d: null, hv20d: hv20d ?? null, putCallRatio: null,
          sma20, atr5, atr20,
          medianVolume5d: vol5 ? Math.round(vol5) : null,
          medianVolume20d: vol20 ? Math.round(vol20) : null,
          obv, rsRatio,
          priceChangePct5d: pct5d,
          priceChangePct10d: pct10d,
        });
      }

      if (rows.length > 0) {
        const batchSize = 50;
        for (let b = 0; b < rows.length; b += batchSize) {
          await db.insert(equityDailyTable)
            .values(rows.slice(b, b + batchSize))
            .onConflictDoUpdate({
              target: [equityDailyTable.symbol, equityDailyTable.date],
              set: {
                open: sql`excluded.open`, high: sql`excluded.high`, low: sql`excluded.low`,
                close: sql`excluded.close`, volume: sql`excluded.volume`,
                hv20d: sql`excluded.hv_20d`, sma20: sql`excluded.sma_20`,
                atr5: sql`excluded.atr_5`, atr20: sql`excluded.atr_20`,
                medianVolume5d: sql`excluded.median_volume_5d`,
                medianVolume20d: sql`excluded.median_volume_20d`,
                obv: sql`excluded.obv`, rsRatio: sql`excluded.rs_ratio`,
                priceChangePct5d: sql`excluded.price_change_pct_5d`,
                priceChangePct10d: sql`excluded.price_change_pct_10d`,
              },
            });
        }
        totalRows += rows.length;
        symbolsDone++;
        logger.info({ sym, rows: rows.length, symbolsDone }, "PolygonEquityBackfill: symbol done");
      }
    } catch (e) {
      logger.warn({ sym, error: (e as Error).message }, "PolygonEquityBackfill: failed");
    }
    await sleep(13000);
  }

  logger.info({ totalRows, symbolsDone }, "PolygonEquityBackfill: complete");
  return { totalRows, symbolsDone };
}

/**
 * Bulk equity update using Polygon's grouped daily bars endpoint.
 * One API call per date returns ALL US stocks — no per-symbol rate limits.
 * Inserts OHLCV into equity_daily for the given symbols; technicals left null
 * (getCompactUniverseSummaries computes returns/volRatio from raw historical rows).
 */
export async function updateEquityDailyFromGroupedBars(
  symbols: string[],
  tradingDates: string[],
): Promise<{ totalRows: number; datesProcessed: number }> {
  const apiKey = process.env["POLYGON_API_KEY"];
  if (!apiKey) return { totalRows: 0, datesProcessed: 0 };

  const symbolSet = new Set(symbols.map(s => s.toUpperCase()));
  let totalRows = 0;
  let datesProcessed = 0;

  for (const dateStr of tradingDates) {
    try {
      const url = `${POLYGON_API}/v2/aggs/grouped/locale/us/market/stocks/${dateStr}?adjusted=true&include_otc=false&apiKey=${apiKey}`;
      const resp = await fetchWithRetry(url, {});
      if (!resp.ok) {
        logger.warn({ dateStr, status: resp.status }, "GroupedDailyUpdate: fetch failed");
        continue;
      }
      const json = await resp.json() as { results?: Array<Record<string, unknown>>; resultsCount?: number };
      const bars = json.results ?? [];
      logger.info({ dateStr, total: bars.length }, "GroupedDailyUpdate: received bars");

      const rows: Array<typeof equityDailyTable.$inferInsert> = [];
      for (const b of bars) {
        const sym = (b["T"] as string ?? "").toUpperCase();
        if (!symbolSet.has(sym)) continue;
        const c = (b["c"] as number) ?? 0;
        if (c <= 0) continue;
        rows.push({
          symbol: sym,
          date: dateStr,
          open: (b["o"] as number) ?? null,
          high: (b["h"] as number) ?? null,
          low: (b["l"] as number) ?? null,
          close: c,
          adjustedClose: c,
          volume: Math.round((b["v"] as number) ?? 0) || null,
        });
      }

      if (rows.length > 0) {
        await db
          .insert(equityDailyTable)
          .values(rows)
          .onConflictDoUpdate({
            target: [equityDailyTable.symbol, equityDailyTable.date],
            set: {
              open: sql`excluded.open`,
              high: sql`excluded.high`,
              low: sql`excluded.low`,
              close: sql`excluded.close`,
              adjustedClose: sql`excluded.adjusted_close`,
              volume: sql`excluded.volume`,
            },
          });
        totalRows += rows.length;
        datesProcessed++;
        logger.info({ dateStr, rows: rows.length }, "GroupedDailyUpdate: inserted");
      }
    } catch (e) {
      logger.warn({ dateStr, error: (e as Error).message }, "GroupedDailyUpdate: error");
    }
    await sleep(5000);
  }

  logger.info({ totalRows, datesProcessed }, "GroupedDailyUpdate: complete");
  return { totalRows, datesProcessed };
}

export async function getSnapshotStatus() {
  const latest = await db
    .select()
    .from(snapshotCollectionLogTable)
    .orderBy(desc(snapshotCollectionLogTable.startedAt))
    .limit(5);
  return latest;
}
