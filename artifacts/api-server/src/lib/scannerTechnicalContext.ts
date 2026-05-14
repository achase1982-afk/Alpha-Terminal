/**
 * Scanner Layer 6 — price-action technicals for expanded card Technical panel.
 *
 * - **52w range / off high**: Schwab batch quote `52WeekHigh` / `52WeekLow` when present;
 *   else trailing ~252 session high/low from daily bars (`equity_daily` or Polygon).
 * - **Daily closes**: last ~420 calendar days from `equity_daily` when row count is sufficient;
 *   otherwise one Polygon `/v2/aggs/ticker/{symbol}/range/1/day/{from}/{to}` per symbol.
 * - **MAs**: simple moving averages of the last 20 / 50 / 200 closes vs **current price**
 *   (Schwab last when present, else last daily close), expressed as percent distance.
 * - **5d / 30d return**: `(currentPrice − priorClose) / priorClose` vs close 5 / 30 sessions earlier.
 */

import { db, equityDailyTable } from "@workspace/db";
import { and, asc, gte, inArray } from "@workspace/db";
import pLimit from "p-limit";
import { logger } from "./logger.js";
import type { SchwabScannerBatchQuote } from "./schwabBatchQuotes.js";

const POLYGON_API = "https://api.polygon.io";
/** Prefer DB-only path when we have enough rows for 200-day MA + returns. */
const DB_ROWS_SUFFICIENT = 230;
const POLYGON_BAR_LIMIT = 400;
const TECH_POLYGON_CONCURRENCY = 8;
const TRADING_DAYS_52W = 252;

export type ScannerTechnicalLayer6Wire = {
  fifty_two_week_low: number | null;
  fifty_two_week_high: number | null;
  off_fifty_two_week_high_pct: number | null;
  vs_twenty_ma_pct: number | null;
  vs_fifty_ma_pct: number | null;
  vs_two_hundred_ma_pct: number | null;
  five_day_return_pct: number | null;
  thirty_day_return_pct: number | null;
};

type OhlcBar = { date: string; close: number; high: number; low: number };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function ymdUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function roundPct(x: number): number {
  return Math.round(x * 100) / 100;
}

function smaLast(closes: readonly number[], n: number): number | null {
  if (closes.length < n) return null;
  let s = 0;
  for (let i = closes.length - n; i < closes.length; i++) s += closes[i]!;
  return s / n;
}

async function fetchWithRetry(url: string, attempts = 3, timeoutMs = 30000): Promise<Response | null> {
  for (let i = 0; i < attempts; i++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ac.signal });
      clearTimeout(t);
      if (r.status === 429) {
        await sleep(2000 * (i + 1));
        continue;
      }
      return r;
    } catch (e) {
      clearTimeout(t);
      if (i === attempts - 1) {
        logger.warn({ url: url.split("?")[0], error: (e as Error).message }, "scannerTechnical.fetchWithRetry failed");
        return null;
      }
      await sleep(500 * (i + 1));
    }
  }
  return null;
}

async function fetchPolygonDailyBars(symbol: string, fromYmd: string, toYmd: string, apiKey: string): Promise<OhlcBar[]> {
  const url =
    `${POLYGON_API}/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/1/day/${fromYmd}/${toYmd}` +
    `?adjusted=true&sort=asc&limit=${POLYGON_BAR_LIMIT}&apiKey=${encodeURIComponent(apiKey)}`;
  const r = await fetchWithRetry(url);
  if (!r || !r.ok) return [];
  const json = (await r.json()) as { results?: Array<Record<string, unknown>> };
  const out: OhlcBar[] = [];
  for (const bar of json.results ?? []) {
    const ts = bar["t"] as number | undefined;
    const c = bar["c"] as number | undefined;
    if (!ts || c == null || !Number.isFinite(c) || c <= 0) continue;
    const h = bar["h"] as number | undefined;
    const l = bar["l"] as number | undefined;
    const hi = h != null && Number.isFinite(h) && h > 0 ? h : c;
    const lo = l != null && Number.isFinite(l) && l > 0 ? l : c;
    out.push({
      date: new Date(ts).toISOString().slice(0, 10),
      close: c,
      high: hi,
      low: lo,
    });
  }
  return out;
}

function normalizeEqDate(d: unknown): string {
  if (typeof d === "string") return d.slice(0, 10);
  if (d instanceof Date) return ymdUtc(d);
  return String(d).slice(0, 10);
}

async function fetchEquityDailyBarsFromDb(symbols: string[], cutoffYmd: string): Promise<Map<string, OhlcBar[]>> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const out = new Map<string, OhlcBar[]>();
  if (uniq.length === 0) return out;

  const rows = await db
    .select({
      symbol: equityDailyTable.symbol,
      date: equityDailyTable.date,
      close: equityDailyTable.close,
      high: equityDailyTable.high,
      low: equityDailyTable.low,
    })
    .from(equityDailyTable)
    .where(and(inArray(equityDailyTable.symbol, uniq), gte(equityDailyTable.date, cutoffYmd)))
    .orderBy(asc(equityDailyTable.symbol), asc(equityDailyTable.date));

  for (const r of rows) {
    const sym = String(r.symbol).toUpperCase().trim();
    const c = Number(r.close);
    if (!Number.isFinite(c) || c <= 0) continue;
    const hRaw = r.high != null ? Number(r.high) : NaN;
    const lRaw = r.low != null ? Number(r.low) : NaN;
    const h = Number.isFinite(hRaw) && hRaw > 0 ? hRaw : c;
    const l = Number.isFinite(lRaw) && lRaw > 0 ? lRaw : c;
    const arr = out.get(sym) ?? [];
    arr.push({ date: normalizeEqDate(r.date), close: c, high: h, low: l });
    out.set(sym, arr);
  }
  return out;
}

export const EMPTY_SCANNER_TECHNICAL_LAYER6_WIRE: ScannerTechnicalLayer6Wire = {
  fifty_two_week_low: null,
  fifty_two_week_high: null,
  off_fifty_two_week_high_pct: null,
  vs_twenty_ma_pct: null,
  vs_fifty_ma_pct: null,
  vs_two_hundred_ma_pct: null,
  five_day_return_pct: null,
  thirty_day_return_pct: null,
};

function emptyTechnical(): ScannerTechnicalLayer6Wire {
  return { ...EMPTY_SCANNER_TECHNICAL_LAYER6_WIRE };
}

function computeTechnical(bars: OhlcBar[], quote: SchwabScannerBatchQuote | undefined): ScannerTechnicalLayer6Wire {
  if (bars.length === 0) return emptyTechnical();

  const closes = bars.map((b) => b.close);
  const lastClose = closes[closes.length - 1]!;
  const qp = quote?.price;
  const currentPrice =
    qp != null && Number.isFinite(qp) && qp > 0 ? qp : lastClose;

  const schwabH = quote?.fiftyTwoWeekHigh;
  const schwabL = quote?.fiftyTwoWeekLow;
  let fiftyTwoHigh: number | null = null;
  let fiftyTwoLow: number | null = null;
  if (
    schwabH != null &&
    schwabL != null &&
    Number.isFinite(schwabH) &&
    Number.isFinite(schwabL) &&
    schwabH > 0 &&
    schwabL > 0 &&
    schwabH >= schwabL
  ) {
    fiftyTwoHigh = schwabH;
    fiftyTwoLow = schwabL;
  } else {
    const trail = bars.slice(Math.max(0, bars.length - TRADING_DAYS_52W));
    let maxH = -Infinity;
    let minL = Infinity;
    for (const b of trail) {
      if (b.high > maxH) maxH = b.high;
      if (b.low < minL) minL = b.low;
    }
    if (Number.isFinite(maxH) && Number.isFinite(minL) && maxH > 0 && minL > 0 && maxH >= minL) {
      fiftyTwoHigh = maxH;
      fiftyTwoLow = minL;
    }
  }

  let offHigh: number | null = null;
  if (fiftyTwoHigh != null && fiftyTwoHigh > 0 && currentPrice > 0) {
    offHigh = roundPct((currentPrice / fiftyTwoHigh - 1) * 100);
  }

  const sma20 = smaLast(closes, 20);
  const sma50 = smaLast(closes, 50);
  const sma200 = smaLast(closes, 200);

  const vs20 = sma20 != null && sma20 > 0 ? roundPct((currentPrice / sma20 - 1) * 100) : null;
  const vs50 = sma50 != null && sma50 > 0 ? roundPct((currentPrice / sma50 - 1) * 100) : null;
  const vs200 = sma200 != null && sma200 > 0 ? roundPct((currentPrice / sma200 - 1) * 100) : null;

  let fiveD: number | null = null;
  if (closes.length >= 6) {
    const prior = closes[closes.length - 6]!;
    if (prior > 0) fiveD = roundPct((currentPrice / prior - 1) * 100);
  }

  let thirtyD: number | null = null;
  if (closes.length >= 31) {
    const prior = closes[closes.length - 31]!;
    if (prior > 0) thirtyD = roundPct((currentPrice / prior - 1) * 100);
  }

  return {
    fifty_two_week_low: fiftyTwoLow,
    fifty_two_week_high: fiftyTwoHigh,
    off_fifty_two_week_high_pct: offHigh,
    vs_twenty_ma_pct: vs20,
    vs_fifty_ma_pct: vs50,
    vs_two_hundred_ma_pct: vs200,
    five_day_return_pct: fiveD,
    thirty_day_return_pct: thirtyD,
  };
}

export function technicalLayer6HasAnyData(t: ScannerTechnicalLayer6Wire): boolean {
  return (
    t.fifty_two_week_low != null ||
    t.fifty_two_week_high != null ||
    t.off_fifty_two_week_high_pct != null ||
    t.vs_twenty_ma_pct != null ||
    t.vs_fifty_ma_pct != null ||
    t.vs_two_hundred_ma_pct != null ||
    t.five_day_return_pct != null ||
    t.thirty_day_return_pct != null
  );
}

/**
 * Per-symbol technical context for scanner Layer 6.
 *
 * Uses `equity_daily` as the primary historical cache; falls back to Polygon aggregates when
 * row coverage is light (e.g. recent listings). At most **one** Polygon aggregate request per symbol.
 */
export async function fetchScannerTechnicalContextForSymbols(
  symbols: string[],
  quoteMap: ReadonlyMap<string, SchwabScannerBatchQuote>,
): Promise<Map<string, ScannerTechnicalLayer6Wire>> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const out = new Map<string, ScannerTechnicalLayer6Wire>();
  if (uniq.length === 0) return out;

  const today = new Date();
  const toYmd = ymdUtc(today);
  const fromCal = new Date(today);
  fromCal.setUTCDate(fromCal.getUTCDate() - 420);
  const dbCutoff = ymdUtc(fromCal);

  const dbBarsBySym = await fetchEquityDailyBarsFromDb(uniq, dbCutoff);

  const apiKey = process.env["POLYGON_API_KEY"] ?? "";
  const needPolygon = new Set<string>();
  for (const sym of uniq) {
    const len = dbBarsBySym.get(sym)?.length ?? 0;
    if (len < DB_ROWS_SUFFICIENT) needPolygon.add(sym);
  }

  const polygonBySym = new Map<string, OhlcBar[]>();
  if (needPolygon.size > 0 && apiKey) {
    const limit = pLimit(TECH_POLYGON_CONCURRENCY);
    await Promise.all(
      [...needPolygon].map((sym) =>
        limit(async () => {
          const bars = await fetchPolygonDailyBars(sym, dbCutoff, toYmd, apiKey);
          if (bars.length > 0) polygonBySym.set(sym, bars);
        }),
      ),
    );
  } else if (needPolygon.size > 0 && !apiKey) {
    logger.warn(
      { count: needPolygon.size },
      "scannerTechnicalContext: POLYGON_API_KEY missing; thin equity_daily symbols skip Polygon backfill",
    );
  }

  for (const sym of uniq) {
    const dbBars = dbBarsBySym.get(sym) ?? [];
    const polyBars = polygonBySym.get(sym);
    const bars =
      dbBars.length >= DB_ROWS_SUFFICIENT
        ? dbBars
        : polyBars != null && polyBars.length > 0
          ? polyBars
          : dbBars;
    const quote = quoteMap.get(sym);
    out.set(sym, computeTechnical(bars, quote));
  }

  return out;
}
