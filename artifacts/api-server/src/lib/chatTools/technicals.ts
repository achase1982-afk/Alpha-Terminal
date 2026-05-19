import {
  and,
  asc,
  db,
  desc,
  eq,
  equityDailyTable,
  schwabChartEquityBarsTable,
} from "@workspace/db";
import { fetchDailyBollinger20Line } from "../bollingerBandsDaily.js";
import { nyCalendarYmd } from "../polygonMarketCalendar.js";

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

async function sessionVwap(sym: string): Promise<Record<string, unknown>> {
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
    return { sessionApproxVwap: null, sessionDate, barCount: 0 };
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
  return {
    sessionApproxVwap: vol > 0 ? Math.round((pv / vol) * 100) / 100 : null,
    sessionDate,
    barCount: rows.length,
  };
}

async function dailyRsi(sym: string): Promise<Record<string, unknown>> {
  const rows = await db
    .select({ close: equityDailyTable.close, date: equityDailyTable.date })
    .from(equityDailyTable)
    .where(eq(equityDailyTable.symbol, sym))
    .orderBy(desc(equityDailyTable.date))
    .limit(80);
  if (rows.length < 15) {
    return { rsi14: null, asOf: null, lookbackDays: rows.length };
  }
  const chrono = [...rows].reverse();
  const closes = chrono.map((r) => Number(r.close)).filter((n) => Number.isFinite(n));
  const asOfRaw = chrono[chrono.length - 1]?.date as unknown;
  const asOf =
    asOfRaw instanceof Date ? asOfRaw.toISOString().slice(0, 10) : String(asOfRaw ?? "");
  return { rsi14: computeWilderRsi14(closes), asOf, lookbackDays: closes.length };
}

async function sma(sym: string, period: number): Promise<number | null> {
  const rows = await db
    .select({ close: equityDailyTable.close })
    .from(equityDailyTable)
    .where(eq(equityDailyTable.symbol, sym))
    .orderBy(desc(equityDailyTable.date))
    .limit(period);
  if (rows.length < period) return null;
  const sum = rows.reduce((a, r) => a + Number(r.close), 0);
  return Math.round((sum / period) * 100) / 100;
}

/** RSI14, Bollinger 20, session VWAP, SMA20/50 from Postgres bars. */
export async function fetchTechnicalsForSymbol(
  symbol: string,
  period?: string,
): Promise<Record<string, unknown>> {
  const sym = symbol.trim().toUpperCase();
  const [vwap, rsi, bbLine, sma20, sma50] = await Promise.all([
    sessionVwap(sym),
    dailyRsi(sym),
    fetchDailyBollinger20Line(sym),
    sma(sym, 20),
    sma(sym, 50),
  ]);
  return {
    symbol: sym,
    period: period ?? "daily",
    vwap,
    rsi14: rsi,
    bollinger20: bbLine,
    sma20,
    sma50,
  };
}
