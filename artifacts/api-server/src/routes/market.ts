import { Router, type IRouter } from "express";
import {
  GetQuoteResponse,
  GetPriceHistoryResponse,
  GetOptionChainResponse,
} from "@workspace/api-zod";
import { getAccessToken, getBestAccessToken } from "../lib/tokenStore.js";
import { getQuoteBySymbol } from "../lib/schwabStreamer.js";
import { getIBCachedQuote, subscribeQuoteForSymbol, isIBConnected, getIBCompanyName } from "../lib/ibStreamer.js";
import { logFailure } from "../lib/telemetry.js";
import { emitTelemetry } from "../lib/telemetryStore.js";
import { computeIVR, type OptionContract } from "../lib/optionsStrategist.js";
import { fetchPolygonChain } from "../lib/polygonChain.js";

const router: IRouter = Router();

const SCHWAB_API_BASE = "https://api.schwabapi.com/marketdata/v1";

const INDEX_SYMBOL_MAP: Record<string, string> = {
  "VIX":   "$VIX",
  "$VIX":  "$VIX",
  "SPX":   "$SPX",
  "$SPX":  "$SPX",
  "NDX":   "$NDX",
  "$NDX":  "$NDX",
  "RUT":   "$RUT",
  "$RUT":  "$RUT",
  "DJI":   "$DJI",
  "$DJI":  "$DJI",
  "DJIA":  "$DJI",
  "COMP":  "$COMP",
  "$COMP": "$COMP",
  "DXY":   "$DXY",
  "$DXY":  "$DXY",
  "TNX":   "$TNX",
  "$TNX":  "$TNX",
  "TYX":   "$TYX",
  "$TYX":  "$TYX",
  "VXN":   "$VXN",
  "$VXN":  "$VXN",
  "OEX":   "$OEX",
  "$OEX":  "$OEX",
  "MNX":   "$MNX",
  "$MNX":  "$MNX",
  "XSP":   "$XSP",
  "$XSP":  "$XSP",
  "TICK":  "$TICK",
  "$TICK": "$TICK",
  "TRIN":  "$TRIN",
  "$TRIN": "$TRIN",
  "ADD":   "$ADD",
  "$ADD":  "$ADD",
  "ADVN":  "$ADVN",
  "$ADVN": "$ADVN",
  "DECN":  "$DECN",
  "$DECN": "$DECN",
  "VVIX":  "$VVIX",
  "$VVIX": "$VVIX",
  "VIX9D": "$VIX9D",
  "$VIX9D":"$VIX9D",
  "VIX3M": "$VIX3M",
  "$VIX3M":"$VIX3M",
};

function formatSchwabSymbol(symbol: string): string {
  let upper = symbol.toUpperCase().trim();
  if (upper.endsWith(".X") && upper.startsWith("$")) {
    upper = upper.slice(0, -2);
  }
  return INDEX_SYMBOL_MAP[upper] ?? upper;
}

function isIndex(symbol: string): boolean {
  const upper = symbol.toUpperCase().trim();
  const bare = upper.endsWith(".X") && upper.startsWith("$") ? upper.slice(0, -2) : upper;
  return bare in INDEX_SYMBOL_MAP;
}

function isFutures(symbol: string): boolean {
  return symbol.trim().startsWith("/");
}

const fiftyTwoWeekCache = new Map<string, { high: number; low: number; ts: number }>();
const FIFTY_TWO_WEEK_TTL = 3600_000;
const FIFTY_TWO_WEEK_MAX = 500;

function getCached52W(symbol: string): { high: number | undefined; low: number | undefined } {
  const entry = fiftyTwoWeekCache.get(symbol);
  if (!entry) return { high: undefined, low: undefined };
  if (Date.now() - entry.ts > FIFTY_TWO_WEEK_TTL) {
    fiftyTwoWeekCache.delete(symbol);
    return { high: undefined, low: undefined };
  }
  return { high: entry.high, low: entry.low };
}

function setCached52W(symbol: string, high: number | undefined, low: number | undefined) {
  if (high !== undefined && low !== undefined) {
    if (fiftyTwoWeekCache.size >= FIFTY_TWO_WEEK_MAX) {
      const oldest = fiftyTwoWeekCache.keys().next().value;
      if (oldest) fiftyTwoWeekCache.delete(oldest);
    }
    fiftyTwoWeekCache.set(symbol, { high, low, ts: Date.now() });
  }
}

const pending52WFetches = new Set<string>();
const W52_KEYS_HIGH = ["52WeekHigh", "highPrice52Week", "52WkHigh", "fiftyTwoWeekHigh"];
const W52_KEYS_LOW  = ["52WeekLow",  "lowPrice52Week",  "52WkLow",  "fiftyTwoWeekLow"];

function pickFirst(src: Record<string, any>, keys: string[]): number | undefined {
  for (const k of keys) {
    const v = src[k];
    if (typeof v === "number" && isFinite(v) && !isNaN(v)) return v;
  }
  return undefined;
}

async function fetch52WBackground(displaySymbol: string, apiSymbol: string, accessToken: string, log: any) {
  if (pending52WFetches.has(displaySymbol)) return;
  pending52WFetches.add(displaySymbol);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 5000);
  try {
    const resp = await fetch(`${SCHWAB_API_BASE}/quotes?symbols=${encodeURIComponent(apiSymbol)}&fields=quote`, {
      headers: { "Authorization": `Bearer ${accessToken}` },
      signal: ac.signal,
    });
    if (!resp.ok) return;
    const json = await resp.json() as Record<string, any>;
    const entry = json[apiSymbol] ?? json[displaySymbol] ?? Object.values(json)[0];
    const q = entry?.quote ?? entry;
    if (!q) return;
    const high = pickFirst(q, W52_KEYS_HIGH);
    const low  = pickFirst(q, W52_KEYS_LOW);
    if (high !== undefined && low !== undefined) {
      setCached52W(displaySymbol, high, low);
      log.info({ symbol: displaySymbol, high, low }, "52W cache populated from background fetch");
    }
  } catch {
  } finally {
    clearTimeout(timer);
    pending52WFetches.delete(displaySymbol);
  }
}

router.get("/quote", async (req, res) => {
  const symbol = req.query["symbol"] as string;
  const accessToken = (req.query["accessToken"] as string) || getAccessToken("market");

  if (!symbol || !accessToken) {
    return res.status(400).json({ symbol: "", error: "symbol is required and no access token available" });
  }

  const displaySymbol = symbol.toUpperCase().trim();
  const apiSymbol = formatSchwabSymbol(displaySymbol);

  const schwabCached = getQuoteBySymbol(apiSymbol);
  if (schwabCached && schwabCached.last !== null) {
    const cachedDesc = apiSymbol === "$DXY" ? "Dollar Index (Synthetic)" : (isIBConnected() ? getIBCompanyName(displaySymbol) ?? undefined : undefined);
    const w52 = getCached52W(displaySymbol);
    if (w52.high === undefined && w52.low === undefined && accessToken) {
      void fetch52WBackground(displaySymbol, apiSymbol, accessToken, req.log);
    }
    const data = GetQuoteResponse.parse({
      symbol: displaySymbol,
      description: cachedDesc,
      last: schwabCached.last ?? undefined,
      bid: schwabCached.bid ?? undefined,
      ask: schwabCached.ask ?? undefined,
      change: schwabCached.change ?? undefined,
      changePct: schwabCached.changePct ?? undefined,
      volume: schwabCached.volume ?? undefined,
      high: schwabCached.high ?? undefined,
      low: schwabCached.low ?? undefined,
      bidSize: schwabCached.bidSize ?? undefined,
      askSize: schwabCached.askSize ?? undefined,
      fiftyTwoWeekHigh: w52.high,
      fiftyTwoWeekLow: w52.low,
    });
    return res.json(data);
  }

  // ── IB FIRST: check cache, subscribe on-demand if needed ─────────────────
  if (isIBConnected()) {
    let ibQuote = getIBCachedQuote(displaySymbol);
    if (!ibQuote) {
      // Not cached yet — subscribe and wait briefly for first tick
      const subscribed = subscribeQuoteForSymbol(displaySymbol);
      if (subscribed) {
        await new Promise(r => setTimeout(r, 200));
        ibQuote = getIBCachedQuote(displaySymbol);
      }
    }
    if (ibQuote && ibQuote.last !== null) {
      const ibDesc = getIBCompanyName(displaySymbol) ?? undefined;
      const w52 = getCached52W(displaySymbol);
      if (w52.high === undefined && w52.low === undefined && accessToken) {
        void fetch52WBackground(displaySymbol, apiSymbol, accessToken, req.log);
      }
      const data = GetQuoteResponse.parse({
        symbol: displaySymbol,
        description: ibDesc,
        last: ibQuote.last ?? undefined,
        bid: ibQuote.bid ?? undefined,
        ask: ibQuote.ask ?? undefined,
        change: ibQuote.change ?? undefined,
        changePct: ibQuote.changePct ?? undefined,
        volume: ibQuote.volume ?? undefined,
        high: ibQuote.high ?? undefined,
        low: ibQuote.low ?? undefined,
        bidSize: ibQuote.bidSize ?? undefined,
        askSize: ibQuote.askSize ?? undefined,
        fiftyTwoWeekHigh: w52.high,
        fiftyTwoWeekLow: w52.low,
      });
      return res.json(data);
    }
  }

  // ── SCHWAB FALLBACK ───────────────────────────────────────────────────────
  try {
    const response = await fetch(`${SCHWAB_API_BASE}/quotes?symbols=${encodeURIComponent(apiSymbol)}&fields=quote,fundamental,reference`, {
      headers: { "Authorization": `Bearer ${accessToken}` },
    });

    if (response.status === 401) {
      const data = GetQuoteResponse.parse({ symbol: displaySymbol, error: "unauthorized" });
      return res.json(data);
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after") ?? "unknown";
      req.log.warn({ symbol: displaySymbol }, "Schwab 429 rate limit hit — backing off");
      void logFailure("SCHWAB_API", "WARN", `Schwab rate limit (429) on /quotes for ${displaySymbol}`, { endpoint: "/quotes", symbol: displaySymbol, retryAfter });
      const data = GetQuoteResponse.parse({ symbol: displaySymbol, error: "rate_limited" });
      return res.status(200).json(data);
    }

    if (!response.ok) {
      void logFailure("SCHWAB_API", "ERROR", `Schwab API non-200 on /quotes: HTTP ${response.status}`, { endpoint: "/quotes", symbol: displaySymbol, status: response.status });
      const data = GetQuoteResponse.parse({ symbol: displaySymbol, error: `api_error_${response.status}` });
      return res.json(data);
    }

    const json = await response.json() as Record<string, unknown>;
    const responseKeys = Object.keys(json);
    const entry = (json[apiSymbol] ?? json[displaySymbol] ?? Object.values(json)[0]) as Record<string, unknown> | undefined;

    if (!entry) {
      req.log.warn({ symbol: displaySymbol, apiSymbol, responseKeys }, "No entry found in Schwab response");
    }

    const quote = entry?.["quote"] as Record<string, unknown> | undefined;
    const fundamental = entry?.["fundamental"] as Record<string, unknown> | undefined;
    const reference = entry?.["reference"] as Record<string, unknown> | undefined;

    // Company name — robust multi-key extraction with stdout diagnostic
    const description =
      (reference?.["description"] as string | undefined) ||
      (entry?.["description"] as string | undefined) ||
      (quote?.["description"] as string | undefined) ||
      (reference?.["companyName"] as string | undefined) ||
      (entry?.["companyName"] as string | undefined) ||
      (quote?.["companyName"] as string | undefined) ||
      undefined;

    if (!quote) {
      const data = GetQuoteResponse.parse({ symbol: displaySymbol, error: "no_data" });
      return res.json(data);
    }

    // ── DEBUG: log every key Schwab actually returned ──────────────────────
    // This surfaces the real field names so we can extend the mapping below.
    req.log.info({ symbol: displaySymbol, quoteKeys: Object.keys(quote) }, "Schwab raw quote keys");
    if (fundamental) {
      req.log.info({ symbol: displaySymbol, fundamentalKeys: Object.keys(fundamental) }, "Schwab raw fundamental keys");
    }
    if (reference) {
      req.log.info({ symbol: displaySymbol, referenceKeys: Object.keys(reference) }, "Schwab raw reference keys");
    }

    // ── Robust number extractor ───────────────────────────────────────────────
    // Returns the first key whose value is a finite, non-NaN number.
    // Searches quote, then reference, then fundamental objects.
    function pickNum(...keys: string[]): number | undefined {
      for (const src of [quote, reference, fundamental]) {
        if (!src) continue;
        for (const k of keys) {
          const v = src[k];
          if (typeof v === "number" && isFinite(v) && !isNaN(v)) return v;
        }
      }
      return undefined;
    }

    // ── Last / mark price ─────────────────────────────────────────────────────
    const last = pickNum(
      "lastPrice",
      "last",
      "mark",
      "markPrice",
      "regularMarketLastPrice",
    );

    // ── Previous close — used as fallback anchor for computed change ──────────
    const prevClose = pickNum(
      "closePrice",           // standard REST field
      "close",
      "previousClose",
      "regularMarketPreviousClose",
    );

    // ── Net dollar change ─────────────────────────────────────────────────────
    // Schwab field names vary by asset type and session:
    //   Regular hours:  netChange, regularMarketNetChange
    //   Extended hours: extendedChange, markChange, postMarketChange
    let change = pickNum(
      "netChange",
      "regularMarketNetChange",
      "markChange",
      "extendedChange",
      "postMarketChange",
      "preMarketChange",
    );

    // Computed fallback: last − previous_close (always available)
    if (change === undefined && last !== undefined && prevClose !== undefined && prevClose !== 0) {
      change = parseFloat((last - prevClose).toFixed(4));
    }

    // ── Percent change ────────────────────────────────────────────────────────
    let changePct = pickNum(
      "netPercentChange",
      "futurePercentChange",
      "netPercentChangeInDouble",
      "regularMarketPercentChangeInDouble",
      "markPercentChange",
      "extendedPercentChange",
      "postMarketPercentChange",
      "preMarketPercentChange",
    );

    // Computed fallback: (change / prevClose) × 100
    if (changePct === undefined && change !== undefined && prevClose !== undefined && prevClose !== 0) {
      changePct = parseFloat(((change / prevClose) * 100).toFixed(4));
    }

    req.log.info(
      { symbol: displaySymbol, last, prevClose, change, changePct },
      "Quote parsed"
    );

    const w52High = pickNum("52WeekHigh", "highPrice52Week", "52WkHigh", "fiftyTwoWeekHigh");
    const w52Low  = pickNum("52WeekLow",  "lowPrice52Week",  "52WkLow",  "fiftyTwoWeekLow");
    setCached52W(displaySymbol, w52High, w52Low);

    const data = GetQuoteResponse.parse({
      symbol: displaySymbol,
      description,
      last,
      bid:   pickNum("bidPrice", "bid"),
      ask:   pickNum("askPrice", "ask"),
      change,
      changePct,
      volume: pickNum("totalVolume", "volume"),
      high:   pickNum("highPrice",  "dayHigh",  "regularMarketHigh"),
      low:    pickNum("lowPrice",   "dayLow",   "regularMarketLow"),
      fiftyTwoWeekHigh: w52High,
      fiftyTwoWeekLow:  w52Low,
      peRatio: (fundamental?.["peRatio"] as number) ?? undefined,
      nextEarningsDate: typeof fundamental?.["nextEarningsDate"] === "string" ? fundamental["nextEarningsDate"] : undefined,
    });

    res.json({
      ...data,
      bidSize: pickNum("bidSize") ?? undefined,
      askSize: pickNum("askSize") ?? undefined,
    });
  } catch (err) {
    req.log.error({ err }, "Quote fetch error");
    const data = GetQuoteResponse.parse({ symbol: displaySymbol, error: "internal_error" });
    res.json(data);
  }
});

const VALID_PERIOD_TYPES = ["day", "month", "year"] as const;
const VALID_PERIODS: Record<string, number[]> = {
  day: [1, 2, 3, 4, 5, 10],
  month: [1, 2, 3, 6],
  year: [1, 2, 3, 5, 10, 15, 20],
};
const VALID_FREQUENCY_TYPES = ["minute", "daily", "weekly", "monthly"] as const;
const VALID_FREQUENCIES: Record<string, number[]> = {
  minute: [1, 5, 10, 15, 30],
  daily: [1],
  weekly: [1],
  monthly: [1],
};

router.get("/history", async (req, res) => {
  const symbol = req.query["symbol"] as string;
  const accessToken = (req.query["accessToken"] as string) || getAccessToken("market");
  let periodType = (req.query["periodType"] as string) ?? "month";
  let period = parseInt((req.query["period"] as string) ?? "3", 10);
  let frequencyType = (req.query["frequencyType"] as string) ?? "daily";
  let frequency = parseInt((req.query["frequency"] as string) ?? "1", 10);

  if (!symbol || !accessToken) {
    return res.json({ symbol: "", candles: [], error: "symbol is required and no access token available" });
  }

  const displaySymbol = symbol.toUpperCase().trim();

  if (!(VALID_PERIOD_TYPES as readonly string[]).includes(periodType)) periodType = "month";
  if (!VALID_PERIODS[periodType]?.includes(period)) period = VALID_PERIODS[periodType]?.[0] ?? 1;
  if (!(VALID_FREQUENCY_TYPES as readonly string[]).includes(frequencyType)) frequencyType = "daily";
  if (!VALID_FREQUENCIES[frequencyType]?.includes(frequency)) frequency = VALID_FREQUENCIES[frequencyType]?.[0] ?? 1;

  const apiSymbol = formatSchwabSymbol(displaySymbol);

  try {
    const params = new URLSearchParams({
      symbol: apiSymbol,
      periodType,
      period: String(period),
      frequencyType,
      frequency: String(frequency),
      needExtendedHoursData: "false",
    });

    const response = await fetch(`${SCHWAB_API_BASE}/pricehistory?${params.toString()}`, {
      headers: { "Authorization": `Bearer ${accessToken}` },
    });

    if (response.status === 401) {
      return res.json({ symbol: displaySymbol, candles: [], error: "unauthorized" });
    }

    if (!response.ok) {
      return res.json({ symbol: displaySymbol, candles: [], error: `api_error_${response.status}` });
    }

    const json = await response.json() as { candles?: Array<Record<string, unknown>> };
    const rawCandles = json.candles ?? [];

    const candles = rawCandles.map((c) => ({
      datetime: new Date(c["datetime"] as number).toISOString(),
      open: c["open"] as number,
      high: c["high"] as number,
      low: c["low"] as number,
      close: c["close"] as number,
      volume: c["volume"] as number,
    }));

    const data = GetPriceHistoryResponse.parse({ symbol: displaySymbol, candles });
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Price history fetch error");
    res.json({ symbol: displaySymbol, candles: [], error: "internal_error" });
  }
});

interface ParsedContract {
  strike: number; expiration: string; schwabSymbol?: string; bid?: number; ask?: number; bidSize?: number; askSize?: number; last?: number;
  volume?: number; openInterest?: number; iv?: number; delta?: number;
  gamma?: number; theta?: number; vega?: number; dte?: number;
}

interface CachedChain {
  symbol: string;
  underlyingPrice?: number;
  calls: ParsedContract[];
  puts: ParsedContract[];
  fetchedAt: number;
  totalCalls: number;
  totalPuts: number;
}

const chainCache = new Map<string, CachedChain>();
const chainFetchInFlight = new Map<string, Promise<CachedChain | null>>();
const CHAIN_CACHE_TTL = 60_000;

const optionsNtmCache = new Map<string, { calls: OptionContract[]; puts: OptionContract[]; underlyingPrice?: number; fetchedAt: number }>();
const OPTIONS_NTM_TTL = 25_000;
const CHAIN_CACHE_MAX = 20;

function evictStaleChains() {
  if (chainCache.size <= CHAIN_CACHE_MAX) return;
  const entries = [...chainCache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt);
  while (chainCache.size > CHAIN_CACHE_MAX && entries.length > 0) {
    const oldest = entries.shift()!;
    chainCache.delete(oldest[0]);
  }
}

function parseContracts(map: Record<string, unknown>): ParsedContract[] {
  const contracts: ParsedContract[] = [];
  for (const expDate of Object.values(map)) {
    const strikeMap = expDate as Record<string, unknown>;
    for (const [, options] of Object.entries(strikeMap)) {
      const optionArr = options as Array<Record<string, unknown>>;
      for (const opt of optionArr) {
        const rawStrike = opt["strikePrice"] as number;
        contracts.push({
          strike: Math.round(rawStrike * 100) / 100,
          expiration: opt["expirationDate"] as string,
          schwabSymbol: opt["symbol"] as string | undefined,
          bid: opt["bid"] as number | undefined,
          ask: opt["ask"] as number | undefined,
          bidSize: opt["bidSize"] as number | undefined,
          askSize: opt["askSize"] as number | undefined,
          last: opt["last"] as number | undefined,
          volume: opt["totalVolume"] as number | undefined,
          openInterest: opt["openInterest"] as number | undefined,
          iv: (() => { const v = opt["volatility"] as number | undefined; return (v != null && v > 0) ? v : undefined; })(),
          delta: opt["delta"] as number | undefined,
          gamma: opt["gamma"] as number | undefined,
          theta: opt["theta"] as number | undefined,
          vega: opt["vega"] as number | undefined,
          dte: opt["daysToExpiration"] as number | undefined,
        });
      }
    }
  }
  return contracts;
}

function centerStrikesAroundATM(
  calls: ParsedContract[],
  puts: ParsedContract[],
  underlyingPrice: number,
  desiredCount: number
): { calls: ParsedContract[]; puts: ParsedContract[] } {
  const expMap = new Map<string, Set<number>>();
  for (const c of calls) {
    if (!expMap.has(c.expiration)) expMap.set(c.expiration, new Set());
    expMap.get(c.expiration)!.add(c.strike);
  }
  for (const p of puts) {
    if (!expMap.has(p.expiration)) expMap.set(p.expiration, new Set());
    expMap.get(p.expiration)!.add(p.strike);
  }

  const allowedStrikes = new Map<string, Set<number>>();

  for (const [exp, strikeSet] of expMap) {
    const sorted = [...strikeSet].sort((a, b) => a - b);
    if (sorted.length <= desiredCount) {
      allowedStrikes.set(exp, strikeSet);
      continue;
    }

    let atmIdx = 0;
    let minDist = Infinity;
    for (let i = 0; i < sorted.length; i++) {
      const dist = Math.abs(sorted[i] - underlyingPrice);
      if (dist < minDist) { minDist = dist; atmIdx = i; }
    }

    const belowSpot = sorted[atmIdx] < underlyingPrice;
    const strikesBelow = belowSpot
      ? Math.floor(desiredCount / 2) - 1
      : Math.floor(desiredCount / 2);
    let lo = atmIdx - strikesBelow;
    let hi = lo + desiredCount - 1;

    if (lo < 0) {
      hi -= lo;
      lo = 0;
    }
    if (hi >= sorted.length) {
      lo -= (hi - sorted.length + 1);
      hi = sorted.length - 1;
      if (lo < 0) lo = 0;
    }

    const kept = new Set(sorted.slice(lo, hi + 1));
    allowedStrikes.set(exp, kept);
  }

  const filteredCalls = calls.filter(c => allowedStrikes.get(c.expiration)?.has(c.strike));
  const filteredPuts = puts.filter(p => allowedStrikes.get(p.expiration)?.has(p.strike));
  return { calls: filteredCalls, puts: filteredPuts };
}

const LARGE_CHAIN_SYMBOLS = new Set(["SPY", "QQQ", "AAPL", "TSLA", "AMZN", "NVDA", "META", "MSFT", "GOOG", "GOOGL"]);

async function fetchChainSide(chainSymbol: string, contractType: "CALL" | "PUT", token: string, isFuturesSymbol: boolean, log: any): Promise<{ map: Record<string, unknown>; underlyingPrice?: number } | null> {
  const params = new URLSearchParams({
    symbol: chainSymbol,
    contractType,
    range: "ALL",
  });
  if (isFuturesSymbol) params.set("assetClass", "FUTURES");

  const url = `${SCHWAB_API_BASE}/chains?${params.toString()}`;
  let response = await fetch(url, {
    headers: { "Authorization": `Bearer ${token}` },
    signal: AbortSignal.timeout(25_000),
  });

  if (response.status === 503 || response.status === 502 || response.status === 429) {
    log.warn({ status: response.status, symbol: chainSymbol, contractType }, "Chain side transient error — retrying in 1s");
    await new Promise(r => setTimeout(r, 1000));
    response = await fetch(url, {
      headers: { "Authorization": `Bearer ${token}` },
      signal: AbortSignal.timeout(25_000),
    });
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    log.error({ status: response.status, symbol: chainSymbol, contractType, body: body.slice(0, 500) }, "Chain side fetch failed");
    void logFailure("SCHWAB_API", "ERROR", `Schwab options chain fetch failed: HTTP ${response.status}`, { endpoint: "/chains", symbol: chainSymbol, contractType, status: response.status });
    return null;
  }

  const json = await response.json() as Record<string, unknown>;
  const mapKey = contractType === "CALL" ? "callExpDateMap" : "putExpDateMap";
  return {
    map: json[mapKey] as Record<string, unknown> ?? {},
    underlyingPrice: json["underlyingPrice"] as number | undefined,
  };
}

async function fetchFullChain(displaySymbol: string, token: string, log: any): Promise<CachedChain | null> {
  const isFuturesSymbol = isFutures(displaySymbol);
  const isIndexSymbol = isIndex(displaySymbol);

  const polygonKey = process.env["POLYGON_API_KEY"];
  if (polygonKey && !isFuturesSymbol && !isIndexSymbol) {
    const liveQuote = getIBCachedQuote(displaySymbol) ?? getQuoteBySymbol(displaySymbol);
    const livePrice = liveQuote?.last ?? liveQuote?.close;
    const strikeOpts = livePrice
      ? { strikeMin: Math.floor(livePrice * 0.70), strikeMax: Math.ceil(livePrice * 1.30) }
      : {};
    const poly = await fetchPolygonChain(displaySymbol, polygonKey, {
      maxDte: 60,
      ...strikeOpts,
      maxPages: 12,
      log,
    });
    if (poly && (poly.calls.length + poly.puts.length) > 0) {
      const underlyingPrice = poly.underlyingPrice ?? livePrice;
      const cached: CachedChain = {
        symbol: displaySymbol,
        underlyingPrice,
        calls: poly.calls,
        puts: poly.puts,
        fetchedAt: Date.now(),
        totalCalls: poly.calls.length,
        totalPuts: poly.puts.length,
      };
      chainCache.set(displaySymbol, cached);
      evictStaleChains();
      log.info(
        { symbol: displaySymbol, totalCalls: poly.calls.length, totalPuts: poly.puts.length, source: "polygon" },
        "Options chain cached (Polygon)"
      );
      return cached;
    }
    log.warn({ symbol: displaySymbol }, "Polygon full chain empty — falling back to Schwab");
  }

  const chainSymbol = isFuturesSymbol ? displaySymbol : isIndexSymbol ? formatSchwabSymbol(displaySymbol) : displaySymbol;
  const useSplit = LARGE_CHAIN_SYMBOLS.has(displaySymbol.toUpperCase());

  let calls: ReturnType<typeof parseContracts>;
  let puts: ReturnType<typeof parseContracts>;
  let underlyingPrice: number | undefined;

  if (useSplit) {
    log.info({ symbol: displaySymbol }, "Fetching chain in split mode (CALL + PUT separately)");
    const [callResult, putResult] = await Promise.all([
      fetchChainSide(chainSymbol, "CALL", token, isFuturesSymbol, log),
      fetchChainSide(chainSymbol, "PUT", token, isFuturesSymbol, log),
    ]);

    if (!callResult && !putResult) return null;

    calls = parseContracts(callResult?.map ?? {});
    puts = parseContracts(putResult?.map ?? {});
    underlyingPrice = callResult?.underlyingPrice ?? putResult?.underlyingPrice;
  } else {
    const params = new URLSearchParams({
      symbol: chainSymbol,
      contractType: "ALL",
      range: "ALL",
    });
    if (isFuturesSymbol) params.set("assetClass", "FUTURES");

    const fullChainUrl = `${SCHWAB_API_BASE}/chains?${params.toString()}`;
    let response = await fetch(fullChainUrl, {
      headers: { "Authorization": `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });

    if (response.status === 503 || response.status === 502 || response.status === 429) {
      log.warn({ status: response.status, symbol: chainSymbol }, "Full chain transient error — retrying in 1s");
      await new Promise(r => setTimeout(r, 1000));
      response = await fetch(fullChainUrl, {
        headers: { "Authorization": `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000),
      });
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      log.error({ status: response.status, symbol: chainSymbol, body: body.slice(0, 500) }, "Options chain fetch failed");
      void logFailure("SCHWAB_API", "ERROR", `Schwab full options chain fetch failed: HTTP ${response.status}`, { endpoint: "/chains", symbol: chainSymbol, status: response.status });
      return null;
    }

    const json = await response.json() as Record<string, unknown>;
    underlyingPrice = json["underlyingPrice"] as number | undefined;
    const callMap = json["callExpDateMap"] as Record<string, unknown> ?? {};
    const putMap = json["putExpDateMap"] as Record<string, unknown> ?? {};
    calls = parseContracts(callMap);
    puts = parseContracts(putMap);
  }

  const cached: CachedChain = {
    symbol: displaySymbol,
    underlyingPrice,
    calls,
    puts,
    fetchedAt: Date.now(),
    totalCalls: calls.length,
    totalPuts: puts.length,
  };

  chainCache.set(displaySymbol, cached);
  evictStaleChains();
  log.info({ symbol: displaySymbol, totalCalls: calls.length, totalPuts: puts.length, cacheSize: chainCache.size, split: useSplit }, "Options chain cached");
  return cached;
}

async function getOrFetchChain(displaySymbol: string, token: string, log: any): Promise<CachedChain | null> {
  const existing = chainCache.get(displaySymbol);
  if (existing && (Date.now() - existing.fetchedAt) < CHAIN_CACHE_TTL) {
    return existing;
  }

  const inFlight = chainFetchInFlight.get(displaySymbol);
  if (inFlight) return inFlight;

  const promise = fetchFullChain(displaySymbol, token, log).finally(() => {
    chainFetchInFlight.delete(displaySymbol);
  });
  chainFetchInFlight.set(displaySymbol, promise);

  if (existing) {
    promise.catch(() => {});
    return existing;
  }

  return promise;
}

router.get("/options", async (req, res) => {
  const symbol = req.query["symbol"] as string;
  const accessToken = (req.query["accessToken"] as string) || getAccessToken("market");
  const contractType = (req.query["contractType"] as string) ?? "ALL";
  const strikeCount = parseInt(req.query["strikeCount"] as string) || 10;

  if (!symbol || !accessToken) {
    return res.json({ symbol: "", calls: [], puts: [], error: "symbol and accessToken are required" });
  }

  const displaySymbol = symbol.toUpperCase().trim();

  function sliceAndReturn(entry: { calls: OptionContract[]; puts: OptionContract[]; underlyingPrice?: number }, source: string) {
    let calls = entry.calls;
    let puts = entry.puts;
    const liveQuote = getIBCachedQuote(displaySymbol) ?? getQuoteBySymbol(displaySymbol);
    const livePrice = liveQuote?.last ?? liveQuote?.close ?? entry.underlyingPrice;
    const centerPrice = livePrice ?? entry.underlyingPrice;
    if (centerPrice != null && strikeCount < 100) {
      const centered = centerStrikesAroundATM(calls, puts, centerPrice, strikeCount);
      calls = centered.calls;
      puts = centered.puts;
    }
    if (contractType === "CALL") puts = [];
    else if (contractType === "PUT") calls = [];
    req.log.info({ symbol: displaySymbol, strikeCount, calls: calls.length, puts: puts.length, source, centerPrice, chainPrice: entry.underlyingPrice }, "Options chain (centered)");
    return GetOptionChainResponse.parse({ symbol: displaySymbol, underlyingPrice: livePrice ?? entry.underlyingPrice, calls, puts });
  }

  try {
    const ntmCached = optionsNtmCache.get(displaySymbol);
    if (ntmCached && (Date.now() - ntmCached.fetchedAt) < OPTIONS_NTM_TTL) {
      return res.json(sliceAndReturn(ntmCached, "ntm-cache"));
    }

    const isFuturesSymbol = isFutures(displaySymbol);
    const isIndexSymbol = isIndex(displaySymbol);

    if (!accessToken) {
      return res.json({ symbol: displaySymbol, calls: [], puts: [], error: "no_token" });
    }

    const chainSymbol = isFuturesSymbol ? displaySymbol : isIndexSymbol ? formatSchwabSymbol(displaySymbol) : displaySymbol;

    const params = new URLSearchParams({
      symbol: chainSymbol,
      contractType: "ALL",
      range: "ALL",
    });
    if (isFuturesSymbol) params.set("assetClass", "FUTURES");

    const chainUrl = `${SCHWAB_API_BASE}/chains?${params.toString()}`;
    let response = await fetch(chainUrl, {
      headers: { "Authorization": `Bearer ${accessToken}` },
      signal: req.socket.destroyed ? AbortSignal.abort() : AbortSignal.timeout(15_000),
    });

    if (response.status === 503 || response.status === 502 || response.status === 429) {
      req.log.warn({ status: response.status, symbol: chainSymbol }, "Options chain transient error — retrying in 1s");
      await new Promise(r => setTimeout(r, 1000));
      response = await fetch(chainUrl, {
        headers: { "Authorization": `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15_000),
      });
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      req.log.error({ status: response.status, symbol: chainSymbol, body: body.slice(0, 500) }, "Options chain fetch failed");
      return res.json({ symbol: displaySymbol, calls: [], puts: [], error: "fetch_failed" });
    }

    const json = await response.json() as Record<string, unknown>;
    const underlyingPrice = json["underlyingPrice"] as number | undefined;
    const callMap = json["callExpDateMap"] as Record<string, unknown> ?? {};
    const putMap = json["putExpDateMap"] as Record<string, unknown> ?? {};
    const allCalls = parseContracts(callMap);
    const allPuts = parseContracts(putMap);

    const MAX_DTE = 400;
    const structureCalls = allCalls.filter(c => c.dte <= MAX_DTE).map(c => ({ strike: c.strike, expiration: c.expiration, schwabSymbol: c.schwabSymbol, dte: c.dte }));
    const structurePuts = allPuts.filter(c => c.dte <= MAX_DTE).map(c => ({ strike: c.strike, expiration: c.expiration, schwabSymbol: c.schwabSymbol, dte: c.dte }));

    const entry = { calls: structureCalls, puts: structurePuts, underlyingPrice, fetchedAt: Date.now() };
    optionsNtmCache.set(displaySymbol, entry);
    if (optionsNtmCache.size > 100) {
      const oldest = [...optionsNtmCache.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)[0];
      optionsNtmCache.delete(oldest[0]);
    }

    return res.json(sliceAndReturn(entry, "schwab-structure"));
  } catch (err) {
    req.log.error({ err }, "Options chain fetch error");
    res.json({ symbol: displaySymbol, calls: [], puts: [], error: "internal_error" });
  }
});

router.get("/ticker-stats", async (req, res) => {
  const symbol = (req.query["symbol"] as string || "").toUpperCase().trim();
  const accessToken = (req.query["accessToken"] as string) || getBestAccessToken();

  if (!symbol) {
    return res.json({ symbol: "", pcRatio: null, ivr: null, mmm: null });
  }

  const result: { symbol: string; pcRatio: number | null; ivr: number | null; mmm: number | null } = {
    symbol,
    pcRatio: null,
    ivr: null,
    mmm: null,
  };

  if (accessToken) {
    let cached = chainCache.get(symbol);
    if (!cached || !cached.underlyingPrice || (Date.now() - cached.fetchedAt) >= CHAIN_CACHE_TTL) {
      req.log.info({ symbol, hadCache: !!cached, tokenAvailable: !!accessToken }, "ticker-stats: fetching chain");
      const fresh = await getOrFetchChain(symbol, accessToken, req.log);
      if (fresh) cached = fresh;
    }

    if (cached && cached.underlyingPrice) {
      const price = cached.underlyingPrice;
      const allContracts: OptionContract[] = [...cached.calls, ...cached.puts];
      const now = Date.now();
      const exps = [...new Set(cached.calls.map((c) => c.expiration))]
        .filter((e) => new Date(e).getTime() > now)
        .sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
      const nearestExp = exps[0] as string | undefined;
      if (nearestExp) {
        const nearCalls = cached.calls.filter((c) => c.expiration === nearestExp);
        const nearPuts = cached.puts.filter((p) => p.expiration === nearestExp);
        const atmCall = nearCalls.sort((a, b) => Math.abs(a.strike - price) - Math.abs(b.strike - price))[0];
        const atmPut = nearPuts.sort((a, b) => Math.abs(a.strike - price) - Math.abs(b.strike - price))[0];
        if (atmCall && atmPut) {
          const callMid = ((atmCall.bid ?? 0) + (atmCall.ask ?? 0)) / 2;
          const putMid = ((atmPut.bid ?? 0) + (atmPut.ask ?? 0)) / 2;
          const straddle = callMid + putMid;
          if (straddle > 0) result.mmm = Math.round(straddle * 100) / 100;
        }
      }
      result.ivr = computeIVR(allContracts, price, exps);

      let totalPutVol = 0;
      let totalCallVol = 0;
      for (const c of cached.puts) totalPutVol += (c.volume ?? 0);
      for (const c of cached.calls) totalCallVol += (c.volume ?? 0);
      if (totalCallVol > 0) {
        result.pcRatio = Math.round((totalPutVol / totalCallVol) * 100) / 100;
      }
    }
  } else {
    req.log.warn({ symbol }, "ticker-stats: no access token available — skipping chain");
  }

  res.json(result);
});

router.get("/pc-ratio", async (_req, res) => {
  if (isIBConnected()) {
    subscribeQuoteForSymbol("$PCUSEQTR");
    subscribeQuoteForSymbol("$PCUSINXR");
  }
  const equityQuote = getIBCachedQuote("$PCUSEQTR") ?? getQuoteBySymbol("$PCUSEQTR");
  const indexQuote = getIBCachedQuote("$PCUSINXR") ?? getQuoteBySymbol("$PCUSINXR");

  const pick = (q: typeof equityQuote) => {
    if (!q) return null;
    if (typeof q.last === "number" && q.last > 0) return q.last;
    if (typeof q.close === "number" && q.close > 0) return q.close;
    return null;
  };

  const cpce = pick(equityQuote);
  const cpci = pick(indexQuote);
  const cpc = cpce !== null && cpci !== null ? Math.round(((cpce + cpci) / 2) * 10000) / 10000 : cpce ?? cpci;

  res.json({
    cpce,
    cpceSource: "CBOE Equity Put/Call Ratio (PCUSEQTR via IB)",
    cpci,
    cpciSource: "CBOE Index Put/Call Ratio (PCUSINXR via IB)",
    cpc,
    cpcSource: "Average of CPCE + CPCI",
    ts: equityQuote?.ts ?? indexQuote?.ts ?? null,
  });
});

router.get("/fundamentals", async (req, res) => {
  const symbol = req.query["symbol"] as string;
  const accessToken = (req.query["accessToken"] as string) || getAccessToken("market");

  if (!symbol || !accessToken) {
    return res.status(400).json({ symbol: "", error: "symbol and accessToken are required" });
  }

  const displaySymbol = symbol.toUpperCase().trim();
  const apiSymbol = formatSchwabSymbol(displaySymbol);

  try {
    const response = await fetch(
      `${SCHWAB_API_BASE}/instruments?symbol=${encodeURIComponent(apiSymbol)}&projection=fundamental`,
      { headers: { "Authorization": `Bearer ${accessToken}` } }
    );

    if (response.status === 401) {
      return res.json({ symbol: displaySymbol, error: "unauthorized" });
    }
    if (!response.ok) {
      return res.json({ symbol: displaySymbol, error: `api_error_${response.status}` });
    }

    const json = await response.json() as Record<string, unknown>;
    const instruments = (json["instruments"] ?? []) as Array<Record<string, unknown>>;
    const entry = instruments[0] ?? {};

    const fundamental = (entry["fundamental"] ?? {}) as Record<string, unknown>;

    req.log.info({ symbol: displaySymbol, fundamentalKeys: Object.keys(fundamental) }, "Instruments fundamental keys");

    const rawNextEarnings = fundamental["nextEarningsDate"] ?? fundamental["nextEarning"] ?? fundamental["earningsDate"];
    const nextEarningsDate = typeof rawNextEarnings === "string" ? rawNextEarnings : null;

    res.json({
      symbol: displaySymbol,
      description: (entry["description"] as string) ?? null,
      exchange: (entry["exchange"] as string) ?? null,
      assetType: (entry["assetType"] as string) ?? null,
      marketCap: (fundamental["marketCap"] as number) ?? null,
      sharesOutstanding: (fundamental["sharesOutstanding"] as number) ?? null,
      peRatio: (fundamental["peRatio"] as number) ?? null,
      pbRatio: (fundamental["pbRatio"] as number) ?? null,
      dividendYield: (fundamental["divYield"] as number) ?? null,
      dividendAmount: (fundamental["divAmount"] as number) ?? null,
      eps: (fundamental["epsTTM"] as number) ?? null,
      beta: (fundamental["beta"] as number) ?? null,
      high52: (fundamental["high52"] as number) ?? null,
      low52: (fundamental["low52"] as number) ?? null,
      nextEarningsDate,
      sector: null,
      industry: null,
    });
  } catch (err) {
    req.log.error({ err }, "Fundamentals fetch error");
    res.json({ symbol: displaySymbol, error: "internal_error" });
  }
});

async function fetchBenzingaEarnings(ticker: string, apiKey: string, log: any): Promise<{
  earningsDate: string | null;
  confirmed: boolean;
  time: string | null;
  epsEstimate: string | null;
  epsPrior: string | null;
  revenueEstimate: string | null;
  revenuePrior: string | null;
  period: string | null;
  periodYear: number | null;
} | null> {
  try {
    const url = `https://api.benzinga.com/api/v2.1/calendar/earnings?token=${apiKey}&pageSize=5&parameters%5Btickers%5D=${encodeURIComponent(ticker)}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      log.warn({ status: response.status, ticker }, "Benzinga earnings API error");
      return null;
    }
    const data = await response.json() as {
      earnings?: Array<{
        date: string;
        date_confirmed: number;
        time: string;
        ticker: string;
        eps_est: string;
        eps_prior: string;
        revenue_est: string;
        revenue_prior: string;
        period: string;
        period_year: number;
      }>;
    };
    const items = data.earnings || [];
    const now = new Date().toISOString().slice(0, 10);
    const upcoming = items.find(e => e.date >= now) || items[0];
    if (!upcoming) return null;

    log.info({ ticker, date: upcoming.date }, "Benzinga earnings fetched");
    const timeStr = upcoming.time && upcoming.time !== "00:00:00" ? upcoming.time : null;
    let timingLabel: string | null = null;
    if (timeStr) {
      const hour = parseInt(timeStr.split(":")[0], 10);
      if (hour < 10) timingLabel = "BMO";
      else if (hour >= 16) timingLabel = "AMC";
      else timingLabel = timeStr.slice(0, 5);
    }
    return {
      earningsDate: upcoming.date,
      confirmed: upcoming.date_confirmed === 1,
      time: timingLabel,
      epsEstimate: upcoming.eps_est || null,
      epsPrior: upcoming.eps_prior || null,
      revenueEstimate: upcoming.revenue_est || null,
      revenuePrior: upcoming.revenue_prior || null,
      period: upcoming.period || null,
      periodYear: upcoming.period_year || null,
    };
  } catch (err) {
    log.warn({ err, ticker }, "Benzinga earnings fetch failed");
    return null;
  }
}

async function fetchYahooEarningsDate(cleanSymbol: string, log: any): Promise<string | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(cleanSymbol)}?modules=calendarEvents`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      log.warn({ status: response.status, symbol: cleanSymbol }, "Yahoo earnings fetch failed, trying scrape");
      void logFailure("YAHOO", "WARN", `Yahoo earnings calendar fetch failed: HTTP ${response.status}`, { symbol: cleanSymbol, status: response.status });

      const pageUrl = `https://finance.yahoo.com/quote/${encodeURIComponent(cleanSymbol)}/`;
      const pageRes = await fetch(pageUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        signal: AbortSignal.timeout(8000),
      });
      if (pageRes.ok) {
        const html = await pageRes.text();
        const dateMatch = html.match(/Earnings Date.*?(\w{3} \d{1,2}, \d{4})/s);
        if (dateMatch) {
          const parsed = new Date(dateMatch[1]);
          if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
        }
      }
      return null;
    }

    const json = await response.json() as Record<string, unknown>;
    const result = (json as any)?.quoteSummary?.result?.[0];
    const earnings = result?.calendarEvents?.earnings;
    const earningsDateArr = earnings?.earningsDate;

    if (Array.isArray(earningsDateArr) && earningsDateArr.length > 0) {
      const rawTs = earningsDateArr[0]?.raw;
      if (typeof rawTs === "number") {
        return new Date(rawTs * 1000).toISOString().slice(0, 10);
      }
      const fmt = earningsDateArr[0]?.fmt;
      if (typeof fmt === "string") return fmt;
    }
    return null;
  } catch (err) {
    log.error({ err, symbol: cleanSymbol }, "Yahoo earnings date fetch error");
    void logFailure("YAHOO", "ERROR", `Yahoo earnings date fetch error for ${cleanSymbol}`, { symbol: cleanSymbol, error: String(err) });
    return null;
  }
}

router.get("/earnings-date", async (req, res) => {
  const symbol = (req.query["symbol"] as string || "").toUpperCase().trim();
  if (!symbol) {
    return res.status(400).json({ symbol: "", earningsDate: null });
  }
  const cleanSymbol = symbol.replace(/^\$/, "");
  const benzingaKey = process.env["BENZINGA_API_KEY"];

  const benzingaResult = benzingaKey
    ? await fetchBenzingaEarnings(cleanSymbol, benzingaKey, req.log)
    : null;

  if (benzingaResult?.earningsDate) {
    return res.json({
      symbol: cleanSymbol,
      earningsDate: benzingaResult.earningsDate,
      confirmed: benzingaResult.confirmed,
      time: benzingaResult.time,
      epsEstimate: benzingaResult.epsEstimate,
      epsPrior: benzingaResult.epsPrior,
      revenueEstimate: benzingaResult.revenueEstimate,
      revenuePrior: benzingaResult.revenuePrior,
      period: benzingaResult.period,
      periodYear: benzingaResult.periodYear,
      source: "benzinga",
    });
  }

  const yahooDate = await fetchYahooEarningsDate(cleanSymbol, req.log);
  res.json({
    symbol: cleanSymbol,
    earningsDate: yahooDate,
    confirmed: false,
    time: null,
    epsEstimate: null,
    epsPrior: null,
    revenueEstimate: null,
    revenuePrior: null,
    period: null,
    periodYear: null,
    source: yahooDate ? "yahoo" : null,
  });
});

let cachedBulkEarnings: Array<{
  date: string;
  ticker: string;
  name: string;
  time: string | null;
  confirmed: boolean;
  period: string | null;
  periodYear: number | null;
  epsEstimate: string | null;
  epsPrior: string | null;
  revenueEstimate: string | null;
  revenuePrior: string | null;
}> = [];
let bulkEarningsLastFetch = 0;

async function fetchBulkBenzingaEarnings(apiKey: string, log: any): Promise<typeof cachedBulkEarnings> {
  const now = Date.now();
  if (cachedBulkEarnings.length > 0 && now - bulkEarningsLastFetch < 6 * 60 * 60 * 1000) {
    return cachedBulkEarnings;
  }

  try {
    const today = new Date();
    const threeMonthsAgo = new Date(today);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const dateFrom = threeMonthsAgo.toISOString().slice(0, 10);
    const endDate = new Date(today);
    endDate.setMonth(endDate.getMonth() + 18);
    const dateTo = endDate.toISOString().slice(0, 10);

    const url = `https://api.benzinga.com/api/v2.1/calendar/earnings?token=${apiKey}&pageSize=250&parameters%5Bdate_from%5D=${dateFrom}&parameters%5Bdate_to%5D=${dateTo}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      log.warn({ status: response.status }, "Benzinga bulk earnings fetch failed");
      return cachedBulkEarnings;
    }

    const data = await response.json() as {
      earnings?: Array<{
        date: string;
        date_confirmed: number;
        time: string;
        ticker: string;
        name: string;
        eps_est: string;
        eps_prior: string;
        revenue_est: string;
        revenue_prior: string;
        period: string;
        period_year: number;
        importance: number;
      }>;
    };

    const items = data.earnings || [];
    log.info({ count: items.length }, "Benzinga bulk earnings fetched");

    cachedBulkEarnings = items.map(e => {
      const timeStr = e.time && e.time !== "00:00:00" ? e.time : null;
      let timingLabel: string | null = null;
      if (timeStr) {
        const hour = parseInt(timeStr.split(":")[0], 10);
        if (hour < 10) timingLabel = "BMO";
        else if (hour >= 16) timingLabel = "AMC";
        else timingLabel = timeStr.slice(0, 5);
      }
      return {
        date: e.date,
        ticker: e.ticker,
        name: e.name,
        time: timingLabel,
        confirmed: e.date_confirmed === 1,
        period: e.period || null,
        periodYear: e.period_year || null,
        epsEstimate: e.eps_est || null,
        epsPrior: e.eps_prior || null,
        revenueEstimate: e.revenue_est || null,
        revenuePrior: e.revenue_prior || null,
      };
    });
    bulkEarningsLastFetch = now;
    return cachedBulkEarnings;
  } catch (err) {
    log.warn({ err }, "Benzinga bulk earnings fetch error");
    return cachedBulkEarnings;
  }
}

router.get("/earnings-calendar", async (req, res) => {
  const benzingaKey = process.env["BENZINGA_API_KEY"];
  if (!benzingaKey) {
    return res.json({ earnings: [], source: null });
  }

  const earnings = await fetchBulkBenzingaEarnings(benzingaKey, req.log);
  res.json({ earnings, source: "benzinga" });
});

let cachedEconEvents: Array<{
  id: string;
  date: string;
  time: string | null;
  eventName: string;
  eventCategory: string;
  country: string;
  importance: number;
  consensus: string | null;
  prior: string | null;
  actual: string | null;
  description: string;
}> = [];
let econEventsLastFetch = 0;

async function fetchBenzingaEconCalendar(apiKey: string, log: any) {
  const now = Date.now();
  if (cachedEconEvents.length > 0 && now - econEventsLastFetch < 4 * 60 * 60 * 1000) {
    return cachedEconEvents;
  }
  try {
    const today = new Date();
    const threeMonthsAgo = new Date(today);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 1);
    const dateFrom = threeMonthsAgo.toISOString().slice(0, 10);
    const endDate = new Date(today);
    endDate.setMonth(endDate.getMonth() + 6);
    const dateTo = endDate.toISOString().slice(0, 10);

    const url = `https://api.benzinga.com/api/v2.1/calendar/economics?token=${apiKey}&pageSize=200&parameters%5Bdate_from%5D=${dateFrom}&parameters%5Bdate_to%5D=${dateTo}&parameters%5Bimportance%5D=3&parameters%5Bcountry%5D=USA`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      log.warn({ status: response.status }, "Benzinga economic calendar fetch failed");
      return cachedEconEvents;
    }
    const data = await response.json() as {
      economics?: Array<{
        id: string;
        date: string;
        time: string;
        event_name: string;
        event_category: string;
        country: string;
        importance: number;
        consensus: string;
        consensus_t: string;
        prior: string;
        prior_t: string;
        actual: string;
        actual_t: string;
        description: string;
      }>;
    };
    const items = data.economics || [];
    log.info({ count: items.length }, "Benzinga economic calendar fetched");
    cachedEconEvents = items.map(e => ({
      id: e.id,
      date: e.date,
      time: e.time && e.time !== "00:00:00" ? e.time.slice(0, 5) : null,
      eventName: e.event_name,
      eventCategory: e.event_category,
      country: e.country,
      importance: e.importance,
      consensus: e.consensus || e.consensus_t || null,
      prior: e.prior || e.prior_t || null,
      actual: e.actual || e.actual_t || null,
      description: e.description || "",
    }));
    econEventsLastFetch = now;
    return cachedEconEvents;
  } catch (err) {
    log.warn({ err }, "Benzinga econ calendar error");
    return cachedEconEvents;
  }
}

router.get("/economic-calendar", async (req, res) => {
  const benzingaKey = process.env["BENZINGA_API_KEY"];
  if (!benzingaKey) return res.json({ events: [], source: null });
  const events = await fetchBenzingaEconCalendar(benzingaKey, req.log);
  res.json({ events, source: "benzinga" });
});

export function getCachedEconEvents() { return cachedEconEvents; }
export function getCachedRatings() { return cachedRatings; }

let cachedRatings: Array<{
  id: string;
  date: string;
  ticker: string;
  name: string;
  analyst: string;
  analystName: string;
  actionCompany: string;
  ratingCurrent: string;
  ratingPrior: string;
  ptCurrent: string | null;
  ptPrior: string | null;
  ptPctChange: string | null;
  importance: number;
  url: string;
}> = [];
let ratingsLastFetch = 0;

async function fetchBenzingaRatings(apiKey: string, log: any) {
  const now = Date.now();
  if (cachedRatings.length > 0 && now - ratingsLastFetch < 2 * 60 * 60 * 1000) {
    return cachedRatings;
  }
  try {
    const url = `https://api.benzinga.com/api/v2.1/calendar/ratings?token=${apiKey}&pageSize=100`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      log.warn({ status: response.status }, "Benzinga ratings fetch failed");
      return cachedRatings;
    }
    const data = await response.json() as {
      ratings?: Array<{
        id: string;
        date: string;
        ticker: string;
        name: string;
        analyst: string;
        analyst_name: string;
        action_company: string;
        action_pt: string;
        rating_current: string;
        rating_prior: string;
        pt_current: string;
        pt_prior: string;
        pt_pct_change: string;
        importance: number;
        url: string;
      }>;
    };
    const items = data.ratings || [];
    log.info({ count: items.length }, "Benzinga ratings fetched");
    cachedRatings = items.map(r => ({
      id: r.id,
      date: r.date,
      ticker: r.ticker,
      name: r.name,
      analyst: r.analyst,
      analystName: r.analyst_name,
      actionCompany: r.action_company,
      ratingCurrent: r.rating_current,
      ratingPrior: r.rating_prior,
      ptCurrent: r.pt_current || null,
      ptPrior: r.pt_prior || null,
      ptPctChange: r.pt_pct_change || null,
      importance: r.importance,
      url: r.url || "",
    }));
    ratingsLastFetch = now;
    return cachedRatings;
  } catch (err) {
    log.warn({ err }, "Benzinga ratings error");
    return cachedRatings;
  }
}

router.get("/analyst-ratings", async (req, res) => {
  const benzingaKey = process.env["BENZINGA_API_KEY"];
  if (!benzingaKey) return res.json({ ratings: [], source: null });
  const symbol = (req.query["symbol"] as string || "").toUpperCase().trim();
  const allRatings = await fetchBenzingaRatings(benzingaKey, req.log);
  const ratings = symbol
    ? allRatings.filter(r => r.ticker === symbol)
    : allRatings;
  res.json({ ratings, source: "benzinga" });
});

router.get("/analyst-insights", async (req, res) => {
  const benzingaKey = process.env["BENZINGA_API_KEY"];
  const symbol = (req.query["symbol"] as string || "").toUpperCase().trim();
  if (!benzingaKey || !symbol) return res.json({ insights: [], source: null });
  try {
    const url = `https://api.benzinga.com/api/v1/analyst/insights?token=${benzingaKey}&pageSize=10&symbols=${encodeURIComponent(symbol)}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return res.json({ insights: [], source: null });
    const data = await response.json() as {
      "analyst-insights"?: Array<{
        id: string;
        date: string;
        firm: string;
        action: string;
        rating: string;
        pt: string;
        analyst_insights: string;
        security: { symbol: string; name: string };
      }>;
    };
    const items = data["analyst-insights"] || [];
    req.log.info({ symbol, count: items.length }, "Benzinga analyst insights fetched");
    res.json({
      insights: items.map(i => ({
        id: i.id,
        date: i.date,
        firm: i.firm,
        action: i.action,
        rating: i.rating,
        priceTarget: i.pt || null,
        summary: i.analyst_insights || "",
        ticker: i.security?.symbol || symbol,
        name: i.security?.name || "",
      })),
      source: "benzinga",
    });
  } catch (err) {
    req.log.warn({ err, symbol }, "Benzinga insights error");
    res.json({ insights: [], source: null });
  }
});

router.get("/conference-calls", async (req, res) => {
  const benzingaKey = process.env["BENZINGA_API_KEY"];
  if (!benzingaKey) return res.json({ calls: [], source: null });
  try {
    const today = new Date().toISOString().slice(0, 10);
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 3);
    const dateTo = endDate.toISOString().slice(0, 10);
    const url = `https://api.benzinga.com/api/v2.1/calendar/conference-calls?token=${benzingaKey}&pageSize=100&parameters%5Bdate_from%5D=${today}&parameters%5Bdate_to%5D=${dateTo}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return res.json({ calls: [], source: null });
    const data = await response.json() as {
      conference?: Array<{
        ticker: string;
        name: string;
        date: string;
        start_time: string;
        period: string;
        period_year: number;
        phone_num: string;
        webcast_url: string;
        importance: number;
      }>;
    };
    const items = data.conference || [];
    req.log.info({ count: items.length }, "Benzinga conference calls fetched");
    res.json({
      calls: items.map(c => ({
        ticker: c.ticker,
        name: c.name,
        date: c.date,
        time: c.start_time?.slice(0, 5) || null,
        period: c.period || null,
        periodYear: c.period_year || null,
        phoneNumber: c.phone_num || null,
        webcastUrl: c.webcast_url || null,
        importance: c.importance,
      })),
      source: "benzinga",
    });
  } catch (err) {
    req.log.warn({ err }, "Benzinga conference calls error");
    res.json({ calls: [], source: null });
  }
});

const FUTURES_NEWS_MAP: Record<string, string> = {
  "/ES": "SPY",
  "/MES": "SPY",
  "/NQ": "QQQ",
  "/MNQ": "QQQ",
  "/YM": "DIA",
  "/MYM": "DIA",
  "/RTY": "IWM",
  "/M2K": "IWM",
  "/CL": "USO",
  "/MCL": "USO",
  "/GC": "GLD",
  "/MGC": "GLD",
  "/SI": "SLV",
  "/ZB": "TLT",
  "/ZN": "TLT",
  "/BZ": "BNO",
  "/NG": "UNG",
  "/HG": "CPER",
  "/6E": "FXE",
  "/6J": "FXY",
};

function futuresNewsSymbol(sym: string): string {
  const upper = sym.toUpperCase().trim();
  if (FUTURES_NEWS_MAP[upper]) return FUTURES_NEWS_MAP[upper];
  const base = upper.replace(/[FGHJKMNQUVXZ]\d{1,2}$/, "");
  if (FUTURES_NEWS_MAP[base]) return FUTURES_NEWS_MAP[base];
  return upper;
}

interface NormalizedArticle {
  id: number;
  source: string;
  headline: string;
  summary: string;
  url: string;
  image: string;
  datetime: number;
  related: string;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}

function polygonNewsTicker(symbol: string): string {
  if (symbol.startsWith("/")) {
    const futuresMap: Record<string, string> = {
      "/ES": "I:SPX", "/NQ": "I:NDX", "/YM": "I:DJI", "/RTY": "I:RUT",
      "/CL": "X:CLUSD", "/GC": "X:GCUSD", "/SI": "X:SIUSD", "/NG": "X:NGUSD",
    };
    const base = symbol.replace(/[FGHJKMNQUVXZ]\d{1,2}$/, "");
    return futuresMap[base] || futuresMap[symbol] || "";
  }
  if (symbol.startsWith("$")) {
    const indexMap: Record<string, string> = {
      "$SPX": "I:SPX", "$NDX": "I:NDX", "$DJI": "I:DJI", "$RUT": "I:RUT", "$VIX": "I:VIX",
    };
    return indexMap[symbol] || "";
  }
  return symbol;
}

async function fetchPolygonNews(symbol: string, apiKey: string, log: any): Promise<NormalizedArticle[]> {
  const polygonTicker = polygonNewsTicker(symbol);
  const tickerParam = polygonTicker ? `&ticker=${encodeURIComponent(polygonTicker)}` : "";
  const url = `https://api.polygon.io/v2/reference/news?limit=50${tickerParam}&order=desc&sort=published_utc&apiKey=${apiKey}`;

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });

    if (!response.ok) {
      log.warn({ status: response.status, symbol }, "Polygon news API error");
      return [];
    }

    const data = await response.json() as {
      results?: Array<{
        id: string;
        publisher: { name: string };
        title: string;
        article_url: string;
        image_url?: string;
        description?: string;
        published_utc: string;
        tickers?: string[];
      }>;
    };

    const results = data.results || [];
    log.info({ symbol, count: results.length }, "Polygon news fetched");

    return results.map(a => ({
      id: Math.abs(hashString(a.id || a.article_url)),
      source: (a.publisher?.name || "Polygon").toUpperCase(),
      headline: a.title || "",
      summary: (a.description || "").slice(0, 300),
      url: a.article_url || "",
      image: a.image_url || "",
      datetime: a.published_utc ? Math.floor(new Date(a.published_utc).getTime() / 1000) : Math.floor(Date.now() / 1000),
      related: polygonTicker || symbol,
    }));
  } catch (err) {
    log.warn({ err, symbol }, "Polygon news fetch failed");
    return [];
  }
}

function benzingaTicker(symbol: string): string {
  if (symbol.startsWith("/")) {
    const base = symbol.replace(/[FGHJKMNQUVXZ]\d{1,2}$/, "").replace(/^\//, "");
    return base;
  }
  if (symbol.startsWith("$")) {
    const indexMap: Record<string, string> = {
      "$SPX": "SPY", "$NDX": "QQQ", "$DJI": "DIA", "$RUT": "IWM", "$VIX": "VIX",
    };
    return indexMap[symbol] || symbol.replace(/^\$/, "");
  }
  return symbol;
}

async function fetchBenzingaNews(symbol: string, apiKey: string, log: any): Promise<NormalizedArticle[]> {
  const ticker = benzingaTicker(symbol);
  const url = `https://api.benzinga.com/api/v2/news?token=${apiKey}&pageSize=50&displayOutput=full&tickers=${encodeURIComponent(ticker)}`;

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      log.warn({ status: response.status, symbol }, "Benzinga news API error");
      return [];
    }

    const raw = await response.json() as Array<{
      id: number;
      author: string;
      created: string;
      updated: string;
      title: string;
      teaser: string;
      url: string;
      image?: Array<{ url: string }>;
      stocks?: Array<{ name: string }>;
    }>;

    const articles = Array.isArray(raw) ? raw : [];
    log.info({ symbol, count: articles.length }, "Benzinga news fetched");

    return articles.map(a => ({
      id: Math.abs(a.id || hashString(a.url || a.title)),
      source: "BENZINGA",
      headline: a.title || "",
      summary: (a.teaser || "").replace(/&#\d+;/g, "").slice(0, 300),
      url: a.url || "",
      image: (a.image && a.image.length > 0 ? a.image[0].url : "") || "",
      datetime: a.created ? Math.floor(new Date(a.created).getTime() / 1000) : Math.floor(Date.now() / 1000),
      related: ticker,
    }));
  } catch (err) {
    log.warn({ err, symbol }, "Benzinga news fetch failed");
    return [];
  }
}

async function fetchFinnhubNews(cleanSymbol: string, apiKey: string, log: any): Promise<NormalizedArticle[]> {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const toDate = now.toISOString().slice(0, 10);
  const fromDate = oneWeekAgo.toISOString().slice(0, 10);

  try {
    const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(cleanSymbol)}&from=${fromDate}&to=${toDate}&token=${apiKey}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });

    if (!response.ok) {
      log.warn({ status: response.status, symbol: cleanSymbol }, "Finnhub news API error");
      return [];
    }

    const raw = await response.json() as Array<{
      id: number;
      category: string;
      datetime: number;
      headline: string;
      image: string;
      related: string;
      source: string;
      summary: string;
      url: string;
    }>;

    return (Array.isArray(raw) ? raw : []).slice(0, 30).map(a => ({
      id: a.id,
      source: (a.source || "Unknown").toUpperCase(),
      headline: a.headline || "",
      summary: a.summary || "",
      url: a.url || "",
      image: a.image || "",
      datetime: a.datetime || 0,
      related: a.related || "",
    }));
  } catch (err) {
    log.warn({ err, symbol: cleanSymbol }, "Finnhub news fetch failed");
    return [];
  }
}

router.get("/news", async (req, res) => {
  const symbol = (req.query["symbol"] as string || "").toUpperCase().trim();

  if (!symbol) {
    return res.status(400).json({ articles: [], error: "symbol is required" });
  }

  const isFuturesNews = symbol.startsWith("/");
  const finnhubSymbol = isFuturesNews ? futuresNewsSymbol(symbol) : symbol.replace(/^\$/, "");
  const finnhubKey = process.env["FINNHUB_API_KEY"];
  const polygonKey = process.env["POLYGON_API_KEY"];
  const benzingaKey = process.env["BENZINGA_API_KEY"];

  const [finnhubArticles, polygonArticles, benzingaArticles] = await Promise.all([
    finnhubKey ? fetchFinnhubNews(finnhubSymbol, finnhubKey, req.log) : Promise.resolve([]),
    polygonKey ? fetchPolygonNews(symbol, polygonKey, req.log) : Promise.resolve([]),
    benzingaKey ? fetchBenzingaNews(symbol, benzingaKey, req.log) : Promise.resolve([]),
  ]);

  const seenHeadlines = new Set<string>();
  const merged: NormalizedArticle[] = [];

  for (const source of [benzingaArticles, finnhubArticles, polygonArticles]) {
    for (const a of source) {
      const key = a.headline.toLowerCase().slice(0, 60);
      if (!seenHeadlines.has(key)) {
        seenHeadlines.add(key);
        merged.push(a);
      }
    }
  }

  merged.sort((a, b) => b.datetime - a.datetime);

  res.json({ articles: merged.slice(0, 50) });
});

async function resolveArticleUrl(url: string): Promise<string> {
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    return resp.url || url;
  } catch {
    return url;
  }
}

function isSafeUrl(candidate: string): boolean {
  try {
    const u = new URL(candidate);
    if (!["http:", "https:"].includes(u.protocol)) return false;
    const blocked = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.0\.0\.0|169\.254\.|\[::1\]|\[fc|\[fd)/i;
    if (blocked.test(u.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

router.get("/proxy-article", async (req, res) => {
  const url = req.query.url as string | undefined;
  if (!url) return res.status(400).json({ error: "url required" });

  try {
    if (!isSafeUrl(url)) {
      return res.status(400).json({ error: "blocked host" });
    }

    const parsed = new URL(url);
    const isFinnhub = parsed.hostname === "finnhub.io" && parsed.pathname.startsWith("/api/news");

    let articleUrl = url;
    if (isFinnhub) {
      articleUrl = await resolveArticleUrl(url);
      if (!isSafeUrl(articleUrl)) {
        return res.status(400).json({ error: "blocked host" });
      }
    }

    const response = await fetch(articleUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    });

    const finalUrl = response.url || articleUrl;

    if (!response.ok) {
      const rawTitle = (req.query.title as string) || "Article";
      const rawSource = (req.query.source as string) || "";
      const escH = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      const fallbackHtml = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>*{box-sizing:border-box;margin:0;padding:0}html,body{background:#1C1C1E;color:#e4e4e7}
body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif;padding:20px 16px 80px;max-width:680px;margin:0 auto}
.s{color:#FFB800;font-size:10px;text-transform:uppercase;letter-spacing:.15em;font-family:"SF Mono",monospace;font-weight:600;margin-bottom:8px}
h1{color:#fff;font-size:22px;font-weight:700;line-height:1.3;margin-bottom:24px}
p{color:#a1a1aa;line-height:1.7;margin-bottom:16px}
a{color:#FFB800;text-decoration:none;font-weight:600}a:hover{text-decoration:underline}
</style></head><body>
${rawSource ? `<div class="s">${escH(rawSource)}</div>` : ""}
<h1>${escH(rawTitle)}</h1>
<p>This article requires a subscription or could not be accessed directly.</p>
<p><a href="${escH(articleUrl)}">Read on ${escH(new URL(articleUrl).hostname.replace(/^www\./, ""))} →</a></p>
</body></html>`;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(fallbackHtml);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return res.status(502).json({ error: "not html" });
    }

    const rawHtml = await response.text();

    const { Readability } = await import("@mozilla/readability");
    const { parseHTML } = await import("linkedom");

    function extractArticle(html: string) {
      const { document: doc } = parseHTML(html);
      const reader = new Readability(doc as any, { charThreshold: 100 });
      return reader.parse();
    }

    function sanitizeContent(html: string): string {
      return html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
        .replace(/<object[\s\S]*?<\/object>/gi, "")
        .replace(/<embed[\s\S]*?>/gi, "")
        .replace(/<form[\s\S]*?<\/form>/gi, "")
        .replace(/<input[\s\S]*?>/gi, "")
        .replace(/<textarea[\s\S]*?<\/textarea>/gi, "")
        .replace(/<button[\s\S]*?<\/button>/gi, "")
        .replace(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi, "")
        .replace(/\s+on\w+\s*=\s*"[^"]*"/gi, "")
        .replace(/\s+on\w+\s*=\s*'[^']*'/gi, "")
        .replace(/javascript\s*:/gi, "void:")
        .replace(/data\s*:\s*text\/html/gi, "data:text/plain");
    }

    let article = extractArticle(rawHtml);
    const textLen = article?.textContent?.trim().length ?? 0;

    if (textLen < 200) {
      try {
        const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(finalUrl)}`;
        const cacheResp = await fetch(cacheUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          redirect: "follow",
          signal: AbortSignal.timeout(8000),
        });
        if (cacheResp.ok) {
          const cacheHtml = await cacheResp.text();
          const cacheArticle = extractArticle(cacheHtml);
          const cacheLen = cacheArticle?.textContent?.trim().length ?? 0;
          if (cacheLen > textLen) {
            article = cacheArticle;
            req.log.info({ textLen, cacheLen }, "Used Google cache for better content");
          }
        }
      } catch {}
    }

    const baseObj = new URL(finalUrl);
    const siteName = article?.siteName || baseObj.hostname.replace(/^www\./, "");
    const rawTitle = (req.query.title as string) || article?.title || "Article";
    const rawSource = (req.query.source as string) || siteName;
    const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const title = escHtml(rawTitle);
    const source = escHtml(rawSource);

    const finalTextLen = article?.textContent?.trim().length ?? 0;
    let articleContent: string;
    if (finalTextLen < 100) {
      articleContent = `<p style="color:#a1a1aa;margin-top:24px;">This article is behind a paywall or could not be fully extracted.</p>
<p style="margin-top:16px;"><a href="${escHtml(finalUrl)}" style="color:#FFB800;text-decoration:none;font-weight:600;">Read full article on ${escHtml(baseObj.hostname.replace(/^www\./, ""))} →</a></p>`;
    } else {
      articleContent = sanitizeContent(article?.content || "<p>Could not extract article content.</p>");
    }

    const readerHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=yes">
  <meta name="referrer" content="no-referrer">
  <meta name="format-detection" content="telephone=no">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <base href="${baseObj.origin}/">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: #1C1C1E; color: #e4e4e7; -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
    html { height: 100%; overflow-y: auto; -webkit-overflow-scrolling: touch; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
      line-height: 1.75; font-size: 16px; -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale;
      padding: 20px 16px 80px; padding: 20px max(16px, env(safe-area-inset-left)) calc(80px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-right));
      max-width: 680px; margin: 0 auto; min-height: 100%;
      word-wrap: break-word; overflow-wrap: break-word;
    }
    .reader-source { color: #FFB800; font-size: 10px; text-transform: uppercase; letter-spacing: 0.15em;
      font-family: "SF Mono", SFMono-Regular, ui-monospace, monospace; font-weight: 600; margin-bottom: 8px; }
    .reader-title { color: #fff; font-size: 22px; font-weight: 700; line-height: 1.3; margin-bottom: 12px; }
    .reader-meta { color: #71717a; font-size: 12px; font-family: "SF Mono", monospace; margin-bottom: 24px;
      padding-bottom: 16px; border-bottom: 1px solid #2A2A2C; }
    .reader-content { color: #d4d4d8; }
    .reader-content p { margin-bottom: 1.2em; }
    .reader-content h1, .reader-content h2, .reader-content h3, .reader-content h4 { color: #fff; margin: 1.5em 0 0.5em; font-weight: 600; }
    .reader-content h2 { font-size: 20px; }
    .reader-content h3 { font-size: 18px; }
    .reader-content a { color: #FFB800; text-decoration: none; }
    .reader-content a:hover { text-decoration: underline; }
    .reader-content img { max-width: 100%; height: auto; border-radius: 8px; margin: 16px 0; }
    .reader-content figure { margin: 16px 0; }
    .reader-content figcaption { color: #71717a; font-size: 13px; margin-top: 6px; }
    .reader-content blockquote { border-left: 3px solid #FFB800; padding-left: 16px; margin: 16px 0; color: #a1a1aa; font-style: italic; }
    .reader-content pre, .reader-content code { background: #151517; padding: 2px 6px; border-radius: 4px; font-size: 14px; }
    .reader-content pre { padding: 12px; overflow-x: auto; }
    .reader-content ul, .reader-content ol { margin: 0.8em 0; padding-left: 1.5em; }
    .reader-content li { margin-bottom: 0.4em; }
    .reader-content table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    .reader-content th, .reader-content td { padding: 8px 12px; border: 1px solid #2A2A2C; text-align: left; }
    .reader-content th { background: #151517; color: #fff; font-weight: 600; }
    ::selection { background: #FFB800; color: #0a0a0a; }
    @media (max-width: 480px) { body { padding: 16px 12px 60px; } .reader-title { font-size: 19px; } }
  </style>
</head>
<body>
  <div class="reader-source">${source}</div>
  <h1 class="reader-title">${title.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</h1>
  <div class="reader-meta">${siteName} · ${new URL(finalUrl).hostname}</div>
  <div class="reader-content">${articleContent}</div>
  <script>document.addEventListener("click",function(e){var a=e.target;while(a&&a.tagName!=="A")a=a.parentElement;if(!a||!a.href)return;var h=a.href;if(!h.match(/^https?:\\/\\//))return;e.preventDefault();e.stopPropagation();if(window.parent!==window){try{window.parent.postMessage({type:"proxy-navigate",url:h},document.referrer||"*")}catch(x){window.parent.postMessage({type:"proxy-navigate",url:h},"*")}}},true);</script>
</body>
</html>`;

    function setSecurityHeaders(r: typeof res) {
      r.setHeader("Content-Type", "text/html; charset=utf-8");
      r.setHeader("Cache-Control", "private, max-age=300");
      r.setHeader("X-Content-Type-Options", "nosniff");
      r.setHeader("X-Frame-Options", "SAMEORIGIN");
      r.setHeader("Referrer-Policy", "no-referrer");
      r.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()");
      r.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https: data:; font-src https: data:; base-uri 'self'; form-action 'none'; frame-ancestors 'self'");
    }

    setSecurityHeaders(res);
    res.send(readerHtml);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "fetch failed";
    req.log.error({ err: msg, url }, "proxy-article error");
    const rawTitle = (req.query.title as string) || "Article";
    const rawSource = (req.query.source as string) || "";
    const escH = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const errorHtml = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<style>*{box-sizing:border-box;margin:0;padding:0}html,body{background:#1C1C1E;color:#e4e4e7}
body{font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif;padding:20px 16px 80px;padding:20px max(16px,env(safe-area-inset-left)) 80px max(16px,env(safe-area-inset-right));max-width:680px;margin:0 auto}
.s{color:#FFB800;font-size:10px;text-transform:uppercase;letter-spacing:.15em;font-family:"SF Mono",monospace;font-weight:600;margin-bottom:8px}
h1{color:#fff;font-size:22px;font-weight:700;line-height:1.3;margin-bottom:24px}
p{color:#a1a1aa;line-height:1.7;margin-bottom:16px}
a{color:#FFB800;text-decoration:none;font-weight:600}a:hover{text-decoration:underline}
</style></head><body>
${rawSource ? `<div class="s">${escH(rawSource)}</div>` : ""}
<h1>${escH(rawTitle)}</h1>
<p>Could not load this article.</p>
<p><a href="${escH(url || "")}">Open in browser →</a></p>
</body></html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; form-action 'none'; frame-ancestors 'self'");
    res.send(errorHtml);
  }
});

export { chainCache, getOrFetchChain, CHAIN_CACHE_TTL };
export type { CachedChain, ParsedContract };
export default router;
