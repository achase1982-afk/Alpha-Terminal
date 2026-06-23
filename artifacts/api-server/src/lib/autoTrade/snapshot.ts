import {
  getQuoteBySymbol,
  getStrategistChartEquityBars,
  type SchwabChartEquityBarPoint,
} from "../schwabStreamer.js";
import { computeIndicators, formatTAContext, type Candle } from "../ta.js";

export interface AutoTradeSnapshot {
  symbol: string;
  last: number | null;
  changePct: number | null;
  context: string;
  /** false when we have no live quote — engine should skip the ticker. */
  tradeable: boolean;
}

function barsToCandles(bars: SchwabChartEquityBarPoint[]): Candle[] {
  return bars.map((b) => ({
    datetime: new Date(b.chartTimeMs).toISOString(),
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));
}

/** Session VWAP from 1-minute chart bars (cumulative typical-price × volume). */
function computeVwap(bars: SchwabChartEquityBarPoint[]): number | null {
  let pv = 0;
  let vol = 0;
  for (const b of bars) {
    const typical = (b.high + b.low + b.close) / 3;
    pv += typical * b.volume;
    vol += b.volume;
  }
  return vol > 0 ? pv / vol : null;
}

function formatRecentBars(bars: SchwabChartEquityBarPoint[], count: number): string {
  const recent = bars.slice(-count);
  if (!recent.length) return "  (no intraday bars yet)";
  return recent
    .map((b) => {
      const t = new Date(b.chartTimeMs).toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/New_York",
        hour12: false,
      });
      return `  ${t}  O ${b.open.toFixed(2)}  H ${b.high.toFixed(2)}  L ${b.low.toFixed(2)}  C ${b.close.toFixed(2)}  V ${b.volume}`;
    })
    .join("\n");
}

/**
 * Build a compact, real-time market snapshot for a single symbol that the LLM
 * reads to decide BUY/SELL/HOLD. Combines the live Level 1 quote, intraday
 * 1-minute price action, VWAP, and RSI/EMA momentum indicators.
 */
export function buildAutoTradeSnapshot(symbol: string): AutoTradeSnapshot {
  const sym = symbol.toUpperCase();
  const quote = getQuoteBySymbol(sym);
  const bars = getStrategistChartEquityBars(sym);
  const candles = barsToCandles(bars);
  const ta = computeIndicators(candles);
  const vwap = computeVwap(bars);

  const last = quote?.last ?? ta.lastClose ?? null;
  const changePct = quote?.changePct ?? null;
  const tradeable = last != null && Number.isFinite(last);

  const vwapLine =
    vwap != null && last != null
      ? `VWAP: $${vwap.toFixed(2)} (price ${last >= vwap ? "+" : ""}${(last - vwap).toFixed(2)} vs VWAP)`
      : "VWAP: N/A";

  const quoteLine = quote
    ? `Bid ${quote.bid ?? "—"} x Ask ${quote.ask ?? "—"} | Last $${quote.last ?? "—"} | Day H ${quote.high ?? "—"} / L ${quote.low ?? "—"} | Vol ${quote.volume ?? "—"} | Chg ${quote.changePct?.toFixed(2) ?? "—"}%`
    : "No live quote available.";

  const context = `═══ LIVE SNAPSHOT — ${sym} ═══
${quoteLine}
${vwapLine}

RECENT 1-MIN BARS (most recent last):
${formatRecentBars(bars, 10)}

${formatTAContext(sym, ta)}`;

  return { symbol: sym, last, changePct, context, tradeable };
}
