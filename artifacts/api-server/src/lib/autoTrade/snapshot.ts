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
 * SPY macro backdrop appended to every ticker snapshot as secondary context.
 * Kept factual — interpretation belongs in the decision prompt, not the data.
 */
function buildMacroBackdropContext(): string {
  const spyQuote = getQuoteBySymbol("SPY");
  const spyBars = getStrategistChartEquityBars("SPY");
  if (!spyBars.length) return "MACRO BACKDROP — SPY: data unavailable.";

  const spyCandles = barsToCandles(spyBars);
  const spyTa = computeIndicators(spyCandles);

  const spyLast = spyQuote?.last ?? spyTa.lastClose ?? null;
  const spyChangePct = spyQuote?.changePct ?? null;
  const { ema200, ema200Series } = spyTa;

  if (spyLast == null || ema200 == null) {
    return "MACRO BACKDROP — SPY: data unavailable.";
  }

  const ema200Prev = ema200Series.length >= 2 ? ema200Series[ema200Series.length - 2] : null;
  const slope =
    ema200Prev == null ? "UNKNOWN"
    : ema200 > ema200Prev + 0.01 ? "RISING"
    : ema200 < ema200Prev - 0.01 ? "FALLING"
    : "FLAT";

  const regime = spyLast >= ema200 ? "BULL" : "BEAR";
  const changeLine = spyChangePct != null
    ? ` | Day: ${spyChangePct >= 0 ? "+" : ""}${spyChangePct.toFixed(2)}%`
    : "";

  return `MACRO BACKDROP — SPY (secondary context):
  ${regime} | $${spyLast.toFixed(2)} vs own EMA200 $${ema200.toFixed(2)} (${regime === "BULL" ? "ABOVE" : "BELOW"}) | EMA200 slope: ${slope}${changeLine}`;
}

/**
 * Build a compact, real-time market snapshot for a single symbol that the LLM
 * reads to decide BUY/SELL/HOLD. Combines the live Level 1 quote, intraday
 * 1-minute price action, VWAP, RSI/EMA momentum indicators, and SPY regime.
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

  const macroBackdrop = buildMacroBackdropContext();

  // Individual stock data first — LLM reads the ticker's own setup before macro context.
  const context = `═══ LIVE SNAPSHOT — ${sym} ═══
${quoteLine}
${vwapLine}

RECENT 1-MIN BARS (most recent last):
${formatRecentBars(bars, 10)}

${formatTAContext(sym, ta)}

${macroBackdrop}`;

  return { symbol: sym, last, changePct, context, tradeable };
}
