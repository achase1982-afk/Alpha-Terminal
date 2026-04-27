import { logger } from "./logger.js";
import { injectExternalQuote, type LiveQuote } from "./schwabStreamer.js";

const DEFAULT_SYMBOLS = [
  "AAPL",
  "AMZN",
  "DIA",
  "GOOGL",
  "IWM",
  "META",
  "MSFT",
  "NVDA",
  "QQQ",
  "SPY",
  "TSLA",
  "VIX",
];

type MockState = {
  base: number;
  last: number;
  volume: number;
};

let interval: ReturnType<typeof setInterval> | null = null;
const states = new Map<string, MockState>();

function initialState(symbol: string, idx: number): MockState {
  const seed = [...symbol].reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  const base = symbol === "VIX" ? 16 + (seed % 5) : 80 + idx * 27 + (seed % 19);
  return {
    base,
    last: base,
    volume: 1_000_000 + seed * 1_000,
  };
}

function nextQuote(symbol: string, state: MockState, tick: number): LiveQuote {
  const wave = Math.sin((tick + state.base) / 8) * 0.004;
  const drift = Math.cos((tick + state.base) / 17) * 0.0015;
  state.last = Math.max(0.5, state.last * (1 + wave + drift));
  state.volume += 2_500 + Math.round(Math.abs(wave) * 100_000);

  const change = state.last - state.base;
  const bid = state.last - 0.01;
  const ask = state.last + 0.01;

  return {
    symbol,
    last: Number(state.last.toFixed(2)),
    regularLast: Number(state.last.toFixed(2)),
    extendedLast: null,
    bid: Number(bid.toFixed(2)),
    ask: Number(ask.toFixed(2)),
    bidSize: 100,
    askSize: 100,
    change: Number(change.toFixed(2)),
    changePct: Number(((change / state.base) * 100).toFixed(2)),
    volume: state.volume,
    high: Number(Math.max(state.base, state.last * 1.01).toFixed(2)),
    low: Number(Math.min(state.base, state.last * 0.99).toFixed(2)),
    close: Number(state.base.toFixed(2)),
    ts: Date.now(),
  };
}

export function isDevMockMarketDataEnabled(): boolean {
  return process.env.DEV_MOCK_MARKET_DATA === "true" && process.env.NODE_ENV !== "production";
}

export function getDevMockQuote(symbol: string): LiveQuote {
  const cleanSymbol = symbol.trim().toUpperCase();
  let state = states.get(cleanSymbol);
  if (!state) {
    state = initialState(cleanSymbol, states.size);
    states.set(cleanSymbol, state);
  }
  return nextQuote(cleanSymbol, state, Date.now() / 1_000);
}

export function getDevMockHistory(symbol: string, options?: {
  periodType?: string;
  period?: number;
  frequencyType?: string;
  frequency?: number;
}) {
  const points = options?.periodType === "day" ? 78 : 90;
  const intervalMs = options?.frequencyType === "minute"
    ? Math.max(1, options.frequency ?? 5) * 60_000
    : 24 * 60 * 60_000;
  const quote = getDevMockQuote(symbol);
  const anchor = quote.close ?? quote.last ?? 100;
  const now = Date.now();

  return Array.from({ length: points }, (_, idx) => {
    const phase = idx / 6;
    const close = anchor * (1 + Math.sin(phase) * 0.018 + Math.cos(phase / 2) * 0.008);
    const open = close * (1 + Math.sin(phase - 0.4) * 0.004);
    const high = Math.max(open, close) * 1.003;
    const low = Math.min(open, close) * 0.997;
    return {
      datetime: new Date(now - (points - idx) * intervalMs).toISOString(),
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: 100_000 + idx * 1_500,
    };
  });
}

export function startDevMockMarketData(symbols = DEFAULT_SYMBOLS) {
  if (interval) return;
  if (!isDevMockMarketDataEnabled()) {
    logger.warn("DEV_MOCK_MARKET_DATA ignored in production");
    return;
  }

  const cleanSymbols = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  cleanSymbols.forEach((symbol, idx) => states.set(symbol, initialState(symbol, idx)));

  let tick = 0;
  const publish = () => {
    tick++;
    for (const [symbol, state] of states.entries()) {
      injectExternalQuote(symbol, nextQuote(symbol, state, tick));
    }
  };

  publish();
  interval = setInterval(publish, 1_000);
  logger.warn({ symbols: cleanSymbols }, "DEV_MOCK_MARKET_DATA is ON — publishing synthetic quotes");
}
