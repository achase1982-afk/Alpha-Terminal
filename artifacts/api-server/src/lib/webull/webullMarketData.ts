import { logger } from "../logger.js";
import { getSubscribedEquitySymbols, injectWebullQuote, type LiveQuote } from "../schwabStreamer.js";
import { WebullApiError, webullSignedFetch } from "./webullClient.js";
import { getWebullToken, isWebullTradingReady, webullCredentialsConfigured } from "./webullTokenStore.js";

const SNAPSHOT_PATH = "/market-data/stocks/snapshots/list";
const POLL_MS = 2_000;
const MAX_SYMBOLS_PER_CYCLE = 100;
const REJECT_MS = 2 * 60_000;

/** Tape names that are ETFs. Anything else is tried as a stock, then an ETF. */
const KNOWN_ETFS = new Set([
  "SPY", "QQQ", "IWM", "DIA", "HYG", "LQD", "IEF", "TLT", "GLD", "SLV",
  "USO", "UNG", "DBC", "VTI", "VOO", "VEA", "EEM", "EFA", "SMH", "XBI",
  "ARKK", "XLE", "XLF", "XLK", "XLU", "XLV", "XLI", "XLP", "XLY", "XLB",
  "XLC", "XLRE", "TQQQ", "SQQQ", "UVXY", "VXX", "BITO",
]);

const CORE_TAPE = ["SPY", "QQQ", "IWM", "DIA", "HYG", "LQD", "IEF", "TLT", "GLD", "SLV"];

type Category = "US_STOCK" | "US_ETF";

const categoryBySymbol = new Map<string, Category>();
const rejectedUntil = new Map<string, number>();
let rotate = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;
let lastErrorLog = 0;

function logPollProblem(err: unknown, detail: Record<string, unknown>): void {
  const now = Date.now();
  if (now - lastErrorLog < 30_000) return;
  lastErrorLog = now;
  logger.warn({ err, ...detail }, "Webull market data poll failed");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];
  for (const key of ["data", "result", "snapshots", "items"]) {
    const nested = payload[key];
    if (Array.isArray(nested)) return nested.filter(isRecord);
  }
  return [];
}

function numOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function epochMs(value: unknown): number | null {
  const n = numOrNull(value);
  if (n == null || n <= 0) return null;
  return n < 1_000_000_000_000 ? Math.round(n * 1000) : Math.round(n);
}

/** Webull stock symbols use a dot (BRK.B). Skip indexes, futures, and option keys. */
export function toWebullEquitySymbol(symbol: string): string | null {
  const upper = symbol.toUpperCase().trim();
  if (!upper || upper.startsWith("$") || upper.startsWith("/")) return null;
  if (/\s/.test(upper) || upper.length > 12) return null;
  const webull = upper.replace(/\//g, ".");
  if (!/^[A-Z][A-Z0-9.]{0,11}$/.test(webull)) return null;
  return webull;
}

function symbolsForCycle(): string[] {
  const wanted = new Set<string>(CORE_TAPE);
  for (const symbol of getSubscribedEquitySymbols()) wanted.add(symbol.toUpperCase());
  const list = [...wanted];
  if (list.length <= MAX_SYMBOLS_PER_CYCLE) return list;
  const start = rotate % list.length;
  rotate = (rotate + MAX_SYMBOLS_PER_CYCLE) % list.length;
  const out: string[] = [];
  for (let i = 0; i < MAX_SYMBOLS_PER_CYCLE; i++) {
    out.push(list[(start + i) % list.length]!);
  }
  return out;
}

async function requestSnapshots(symbols: string[], category: Category): Promise<Record<string, unknown>[]> {
  const payload = await webullSignedFetch<unknown>({
    method: "GET",
    path: SNAPSHOT_PATH,
    query: {
      symbols: symbols.join(","),
      category,
      extend_hour_required: "true",
      overnight_required: "true",
    },
    withAccessToken: true,
    rateBucket: "market",
  });
  return asRows(payload);
}

async function fetchCategory(symbols: string[], category: Category): Promise<Record<string, unknown>[] | null> {
  const now = Date.now();
  const eligible = symbols.filter((symbol) => (rejectedUntil.get(`${category}:${symbol}`) ?? 0) <= now);
  if (eligible.length === 0) return [];
  try {
    return await requestSnapshots(eligible, category);
  } catch (err) {
    const status = err instanceof WebullApiError ? err.status : 0;
    if ((status === 400 || status === 417) && eligible.length > 1) {
      const mid = Math.ceil(eligible.length / 2);
      const left = await fetchCategory(eligible.slice(0, mid), category);
      const right = await fetchCategory(eligible.slice(mid), category);
      if (left == null && right == null) return null;
      return [...(left ?? []), ...(right ?? [])];
    }
    if ((status === 400 || status === 417) && eligible.length === 1) {
      rejectedUntil.set(`${category}:${eligible[0]}`, now + REJECT_MS);
      return [];
    }
    logPollProblem(err, { category, count: eligible.length, status });
    return null;
  }
}

function quoteFromSnapshot(symbol: string, row: Record<string, unknown>): LiveQuote | null {
  const regularLast = numOrNull(row.price);
  const regularTs = epochMs(row.last_trade_time) ?? 0;
  const extendedLast = numOrNull(row.extend_hour_last_price);
  const extendedTs = epochMs(row.extend_hour_last_trade_time) ?? 0;
  const overnightLast = numOrNull(row.ovn_price);
  const overnightTs = epochMs(row.ovn_last_trade_time) ?? 0;
  const candidates = [
    { px: regularLast, ts: regularTs, session: "regular" as const },
    { px: extendedLast, ts: extendedTs, session: "extended" as const },
    { px: overnightLast, ts: overnightTs, session: "overnight" as const },
  ].filter((candidate) => candidate.px != null && candidate.px > 0);
  candidates.sort((a, b) => b.ts - a.ts);
  const best = candidates[0];
  const last = best?.px ?? regularLast ?? extendedLast ?? overnightLast;
  if (last == null || last <= 0) return null;

  const preClose = numOrNull(row.pre_close);
  const change = preClose != null ? last - preClose : numOrNull(row.change);
  const ratio = numOrNull(row.change_ratio);
  const changePct =
    change != null && preClose != null && preClose !== 0
      ? (change / preClose) * 100
      : ratio != null
        ? ratio * 100
        : null;
  const bid = numOrNull(row.bid) ?? numOrNull(row.ovn_bid);
  const ask = numOrNull(row.ask) ?? numOrNull(row.ovn_ask);
  const bidSize = numOrNull(row.bid_size) ?? numOrNull(row.ovn_bid_size);
  const askSize = numOrNull(row.ask_size) ?? numOrNull(row.ovn_ask_size);
  const now = Date.now();
  const extendedSession = best?.session === "extended" || best?.session === "overnight";
  const high = extendedSession
    ? numOrNull(row.extend_hour_high) ?? numOrNull(row.ovn_high) ?? numOrNull(row.high)
    : numOrNull(row.high);
  const low = extendedSession
    ? numOrNull(row.extend_hour_low) ?? numOrNull(row.ovn_low) ?? numOrNull(row.low)
    : numOrNull(row.low);

  return {
    symbol,
    last,
    regularLast,
    extendedLast: extendedLast ?? overnightLast,
    bid,
    ask,
    bidSize,
    askSize,
    bidQuoteTs: bid != null && bidSize != null ? now : null,
    askQuoteTs: ask != null && askSize != null ? now : null,
    change,
    changePct,
    volume: numOrNull(row.volume) ?? numOrNull(row.ovn_volume),
    high,
    low,
    close: preClose,
    ts: now,
    tradeTimeMs: best && best.ts > 0 ? best.ts : null,
    quoteSource: "WEBULL",
  };
}

function indexRows(rows: Record<string, unknown>[]): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const symbol = String(row.symbol ?? "").toUpperCase().trim();
    if (symbol) out.set(symbol, row);
  }
  return out;
}

async function pollOnce(): Promise<void> {
  if (!webullCredentialsConfigured()) return;
  const token = await getWebullToken();
  if (!isWebullTradingReady(token)) return;

  const aliases = new Map<string, string[]>();
  for (const subscribed of symbolsForCycle()) {
    const webull = toWebullEquitySymbol(subscribed);
    if (!webull) continue;
    const list = aliases.get(webull) ?? [];
    list.push(subscribed);
    aliases.set(webull, list);
  }
  const symbols = [...aliases.keys()];
  if (symbols.length === 0) return;

  const stocks: string[] = [];
  const etfs: string[] = [];
  const unknown: string[] = [];
  for (const symbol of symbols) {
    const known = categoryBySymbol.get(symbol);
    if (known === "US_ETF" || (!known && KNOWN_ETFS.has(symbol))) etfs.push(symbol);
    else if (known === "US_STOCK") stocks.push(symbol);
    else unknown.push(symbol);
  }

  const stockRows = await fetchCategory([...stocks, ...unknown], "US_STOCK");
  if (stockRows == null) return;
  const stockBySymbol = indexRows(stockRows);
  for (const symbol of stockBySymbol.keys()) categoryBySymbol.set(symbol, "US_STOCK");

  const etfMisses = unknown.filter((symbol) => !stockBySymbol.has(symbol));
  const etfRows = await fetchCategory([...etfs, ...etfMisses], "US_ETF");
  if (etfRows == null) return;
  const etfBySymbol = indexRows(etfRows);
  for (const symbol of etfBySymbol.keys()) categoryBySymbol.set(symbol, "US_ETF");

  const now = Date.now();
  for (const symbol of etfMisses) {
    if (etfBySymbol.has(symbol)) continue;
    rejectedUntil.set(`US_STOCK:${symbol}`, now + REJECT_MS);
    rejectedUntil.set(`US_ETF:${symbol}`, now + REJECT_MS);
  }

  for (const [symbol, row] of [...stockBySymbol, ...etfBySymbol]) {
    const quote = quoteFromSnapshot(symbol, row);
    if (!quote) continue;
    const targets = new Set<string>([symbol, ...(aliases.get(symbol) ?? [])]);
    for (const target of targets) injectWebullQuote({ ...quote, symbol: target });
  }
}

export function startWebullMarketDataPoller(): void {
  if (timer || !webullCredentialsConfigured()) return;
  const tick = () => {
    if (inFlight) return;
    inFlight = true;
    void pollOnce()
      .catch((err) => logPollProblem(err, {}))
      .finally(() => {
        inFlight = false;
      });
  };
  timer = setInterval(tick, POLL_MS);
  tick();
  logger.info("Webull market data poller started");
}
