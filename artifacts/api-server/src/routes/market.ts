import { Router, type IRouter } from "express";
import {
  GetQuoteResponse,
  GetPriceHistoryResponse,
  GetOptionChainResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

const SCHWAB_API_BASE = "https://api.schwabapi.com/marketdata/v1";

// Maps user-friendly symbol names → Schwab API format
const INDEX_SYMBOL_MAP: Record<string, string> = {
  "VIX":  "$VIX.X",
  "SPX":  "$SPX.X",
  "NDX":  "$NDX.X",
  "RUT":  "$RUT.X",
  "DJI":  "$DJI.X",
  "DJIA": "$DJI.X",
  "COMP": "$COMP.X",
  "DXY":  "$DXY.X",
  "TNX":  "$TNX.X",
  "TYX":  "$TYX.X",
  "VXN":  "$VXN.X",
  "OEX":  "$OEX.X",
  "MNX":  "$MNX.X",
  "XSP":  "$XSP.X",
};

function formatSchwabSymbol(symbol: string): string {
  const upper = symbol.toUpperCase().trim();
  return INDEX_SYMBOL_MAP[upper] ?? upper;
}

function isFutures(symbol: string): boolean {
  return symbol.trim().startsWith("/");
}

const PERIOD_MAP: Record<string, { periodType: string; period: number; frequencyType: string; frequency: number }> = {
  "1D":  { periodType: "day",   period: 1,  frequencyType: "minute",  frequency: 5 },
  "5D":  { periodType: "day",   period: 5,  frequencyType: "minute",  frequency: 15 },
  "1M":  { periodType: "month", period: 1,  frequencyType: "daily",   frequency: 1 },
  "3M":  { periodType: "month", period: 3,  frequencyType: "daily",   frequency: 1 },
  "6M":  { periodType: "month", period: 6,  frequencyType: "daily",   frequency: 1 },
  "1Y":  { periodType: "year",  period: 1,  frequencyType: "weekly",  frequency: 1 },
  "2Y":  { periodType: "year",  period: 2,  frequencyType: "weekly",  frequency: 1 },
  "5Y":  { periodType: "year",  period: 5,  frequencyType: "monthly", frequency: 1 },
};

router.get("/quote", async (req, res) => {
  const symbol = req.query["symbol"] as string;
  const accessToken = req.query["accessToken"] as string;

  if (!symbol || !accessToken) {
    return res.status(400).json({ symbol: "", error: "symbol and accessToken are required" });
  }

  const displaySymbol = symbol.toUpperCase().trim();

  // Futures are not supported via this endpoint — fail gracefully
  if (isFutures(displaySymbol)) {
    const data = GetQuoteResponse.parse({ symbol: displaySymbol, error: "futures_not_supported" });
    return res.json(data);
  }

  const apiSymbol = formatSchwabSymbol(displaySymbol);

  try {
    const response = await fetch(`${SCHWAB_API_BASE}/quotes?symbols=${encodeURIComponent(apiSymbol)}&fields=quote,fundamental`, {
      headers: { "Authorization": `Bearer ${accessToken}` },
    });

    if (response.status === 401) {
      const data = GetQuoteResponse.parse({ symbol: displaySymbol, error: "unauthorized" });
      return res.json(data);
    }

    if (!response.ok) {
      const data = GetQuoteResponse.parse({ symbol: displaySymbol, error: `api_error_${response.status}` });
      return res.json(data);
    }

    const json = await response.json() as Record<string, unknown>;
    // Schwab returns data keyed by the formatted symbol (e.g. "$VIX.X")
    const entry = (json[apiSymbol] ?? json[displaySymbol]) as Record<string, unknown> | undefined;
    const quote = entry?.["quote"] as Record<string, unknown> | undefined;
    const fundamental = entry?.["fundamental"] as Record<string, unknown> | undefined;

    if (!quote) {
      const data = GetQuoteResponse.parse({ symbol: displaySymbol, error: "no_data" });
      return res.json(data);
    }

    // Robust field extraction — Schwab uses different field names depending on
    // instrument type (equity, ETF, index) and session (regular vs extended hours).
    function pickNum(...keys: string[]): number | undefined {
      for (const k of keys) {
        const v = quote[k];
        if (typeof v === "number" && !isNaN(v)) return v;
      }
      return undefined;
    }

    // Last price: prefer lastPrice, fall back to mark (bid/ask midpoint) or closePrice
    const last = pickNum("lastPrice", "mark", "closePrice", "regularMarketLastPrice");

    // Net change: try regular-session and extended-hours variants
    const change = pickNum(
      "netChange",
      "regularMarketNetChange",
      "extendedChange",
    );

    // Percent change: try regular-session and extended-hours variants
    const changePct = pickNum(
      "netPercentChangeInDouble",
      "regularMarketPercentChangeInDouble",
      "extendedPercentChange",
    );

    req.log.info({ symbol: displaySymbol, last, change, changePct }, "Quote parsed");

    const data = GetQuoteResponse.parse({
      symbol: displaySymbol,
      last,
      bid:  pickNum("bidPrice", "bid"),
      ask:  pickNum("askPrice", "ask"),
      change,
      changePct,
      volume: pickNum("totalVolume", "volume"),
      high:   pickNum("highPrice", "regularMarketHigh"),
      low:    pickNum("lowPrice",  "regularMarketLow"),
      fiftyTwoWeekHigh: pickNum("52WkHigh", "fiftyTwoWeekHigh"),
      fiftyTwoWeekLow:  pickNum("52WkLow",  "fiftyTwoWeekLow"),
      peRatio: (fundamental?.["peRatio"] as number) ?? undefined,
    });

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Quote fetch error");
    const data = GetQuoteResponse.parse({ symbol: displaySymbol, error: "internal_error" });
    res.json(data);
  }
});

router.get("/history", async (req, res) => {
  const symbol = req.query["symbol"] as string;
  const accessToken = req.query["accessToken"] as string;
  const timeframe = (req.query["timeframe"] as string) ?? "3M";

  if (!symbol || !accessToken) {
    return res.json({ symbol: "", candles: [], error: "symbol and accessToken are required" });
  }

  const displaySymbol = symbol.toUpperCase().trim();

  // Futures are not supported via this endpoint — fail gracefully
  if (isFutures(displaySymbol)) {
    return res.json({ symbol: displaySymbol, candles: [], error: "futures_not_supported" });
  }

  const apiSymbol = formatSchwabSymbol(displaySymbol);
  const periodConfig = PERIOD_MAP[timeframe] ?? PERIOD_MAP["3M"];

  try {
    const params = new URLSearchParams({
      symbol: apiSymbol,
      periodType: periodConfig.periodType,
      period: String(periodConfig.period),
      frequencyType: periodConfig.frequencyType,
      frequency: String(periodConfig.frequency),
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

router.get("/options", async (req, res) => {
  const symbol = req.query["symbol"] as string;
  const accessToken = req.query["accessToken"] as string;
  const contractType = (req.query["contractType"] as string) ?? "ALL";
  const daysToExpiration = Number(req.query["daysToExpiration"] ?? 30);

  if (!symbol || !accessToken) {
    return res.json({ symbol: "", calls: [], puts: [], error: "symbol and accessToken are required" });
  }

  const displaySymbol = symbol.toUpperCase().trim();

  if (isFutures(displaySymbol)) {
    return res.json({ symbol: displaySymbol, calls: [], puts: [], error: "futures_not_supported" });
  }

  const apiSymbol = formatSchwabSymbol(displaySymbol);

  try {
    const params = new URLSearchParams({
      symbol: apiSymbol,
      contractType,
      daysToExpiration: String(daysToExpiration),
      range: "NTM",
    });

    const response = await fetch(`${SCHWAB_API_BASE}/chains?${params.toString()}`, {
      headers: { "Authorization": `Bearer ${accessToken}` },
    });

    if (response.status === 401) {
      return res.json({ symbol: displaySymbol, calls: [], puts: [], error: "unauthorized" });
    }

    if (!response.ok) {
      return res.json({ symbol: displaySymbol, calls: [], puts: [], error: `api_error_${response.status}` });
    }

    const json = await response.json() as Record<string, unknown>;
    const underlyingPrice = json["underlyingPrice"] as number | undefined;

    function parseContracts(map: Record<string, unknown>): Array<{
      strike: number; expiration: string; bid?: number; ask?: number; last?: number;
      volume?: number; openInterest?: number; iv?: number; delta?: number;
      gamma?: number; theta?: number; vega?: number; dte?: number;
    }> {
      const contracts: Array<{
        strike: number; expiration: string; bid?: number; ask?: number; last?: number;
        volume?: number; openInterest?: number; iv?: number; delta?: number;
        gamma?: number; theta?: number; vega?: number; dte?: number;
      }> = [];
      for (const expDate of Object.values(map)) {
        const strikeMap = expDate as Record<string, unknown>;
        for (const [, options] of Object.entries(strikeMap)) {
          const optionArr = options as Array<Record<string, unknown>>;
          for (const opt of optionArr) {
            contracts.push({
              strike: opt["strikePrice"] as number,
              expiration: opt["expirationDate"] as string,
              bid: opt["bid"] as number | undefined,
              ask: opt["ask"] as number | undefined,
              last: opt["last"] as number | undefined,
              volume: opt["totalVolume"] as number | undefined,
              openInterest: opt["openInterest"] as number | undefined,
              iv: opt["volatility"] as number | undefined,
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

    const callMap = json["callExpDateMap"] as Record<string, unknown> ?? {};
    const putMap = json["putExpDateMap"] as Record<string, unknown> ?? {};

    const calls = parseContracts(callMap);
    const puts = parseContracts(putMap);

    const data = GetOptionChainResponse.parse({ symbol: displaySymbol, underlyingPrice, calls, puts });
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Options chain fetch error");
    res.json({ symbol: displaySymbol, calls: [], puts: [], error: "internal_error" });
  }
});

export default router;
