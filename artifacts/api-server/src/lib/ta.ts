import { RSI, EMA, ATR } from "technicalindicators";

export interface Candle {
  datetime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface TAResult {
  rsi14: number | null;
  ema50: number | null;
  ema200: number | null;
  atr14: number | null;
  rsiSeries: number[];
  ema50Series: number[];
  ema200Series: number[];
  lastClose: number | null;
  dataPoints: number;
  latestTimestamp: string | null;
}

export function computeIndicators(candles: Candle[]): TAResult {
  if (!candles.length) {
    return {
      rsi14: null, ema50: null, ema200: null, atr14: null,
      rsiSeries: [], ema50Series: [], ema200Series: [],
      lastClose: null, dataPoints: 0, latestTimestamp: null,
    };
  }

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);

  const rsiSeries = RSI.calculate({ values: closes, period: 14 });
  const ema50Series = EMA.calculate({ values: closes, period: 50 });
  const ema200Series = EMA.calculate({ values: closes, period: 200 });
  const atrSeries = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });

  const last = (arr: number[]) => arr.length > 0 ? arr[arr.length - 1] : null;

  return {
    rsi14: last(rsiSeries),
    ema50: last(ema50Series),
    ema200: last(ema200Series),
    atr14: last(atrSeries),
    rsiSeries,
    ema50Series,
    ema200Series,
    lastClose: closes[closes.length - 1],
    dataPoints: candles.length,
    latestTimestamp: candles[candles.length - 1].datetime,
  };
}

export function formatTAContext(symbol: string, ta: TAResult): string {
  const r = (v: number | null, decimals = 2) =>
    v !== null ? v.toFixed(decimals) : "N/A";

  let trend = "UNDETERMINED";
  if (ta.ema50 !== null && ta.ema200 !== null && ta.lastClose !== null) {
    if (ta.lastClose > ta.ema50 && ta.ema50 > ta.ema200) trend = "BULLISH (price > EMA50 > EMA200)";
    else if (ta.lastClose < ta.ema50 && ta.ema50 < ta.ema200) trend = "BEARISH (price < EMA50 < EMA200)";
    else if (ta.lastClose > ta.ema200 && ta.lastClose < ta.ema50) trend = "PULLBACK (below EMA50, above EMA200)";
    else if (ta.lastClose < ta.ema200 && ta.lastClose > ta.ema50) trend = "RECOVERY (above EMA50, below EMA200)";
    else trend = "MIXED";
  }

  let rsiZone = "N/A";
  if (ta.rsi14 !== null) {
    if (ta.rsi14 >= 70) rsiZone = "OVERBOUGHT";
    else if (ta.rsi14 <= 30) rsiZone = "OVERSOLD";
    else if (ta.rsi14 >= 60) rsiZone = "BULLISH MOMENTUM";
    else if (ta.rsi14 <= 40) rsiZone = "BEARISH MOMENTUM";
    else rsiZone = "NEUTRAL";
  }

  return `═══ TECHNICAL INDICATORS — ${symbol} ═══
Last Close: $${r(ta.lastClose)}
RSI(14): ${r(ta.rsi14)} [${rsiZone}]
EMA(50): $${r(ta.ema50)}
EMA(200): $${r(ta.ema200)}
Trend: ${trend}
Data Points: ${ta.dataPoints} candles
Latest Data: ${ta.latestTimestamp ?? "N/A"}
═══════════════════════════════════════`;
}

export function isDataStale(latestTimestamp: string | null, maxAgeMinutes: number = 5): boolean {
  if (!latestTimestamp) return true;
  const dataTime = new Date(latestTimestamp).getTime();
  if (isNaN(dataTime)) return true;
  const ageMs = Date.now() - dataTime;
  return ageMs > maxAgeMinutes * 60 * 1000;
}
