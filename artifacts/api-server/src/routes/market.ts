import { Router, type IRouter } from "express";
import {
  GetQuoteResponse,
  GetPriceHistoryResponse,
  GetOptionChainResponse,
} from "@workspace/api-zod";

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
  return upper in INDEX_SYMBOL_MAP || upper.startsWith("$");
}

function isFutures(symbol: string): boolean {
  return symbol.trim().startsWith("/");
}


router.get("/quote", async (req, res) => {
  const symbol = req.query["symbol"] as string;
  const accessToken = req.query["accessToken"] as string;

  if (!symbol || !accessToken) {
    return res.status(400).json({ symbol: "", error: "symbol and accessToken are required" });
  }

  const displaySymbol = symbol.toUpperCase().trim();
  const apiSymbol = formatSchwabSymbol(displaySymbol);

  try {
    const response = await fetch(`${SCHWAB_API_BASE}/quotes?symbols=${encodeURIComponent(apiSymbol)}&fields=quote,fundamental,reference`, {
      headers: { "Authorization": `Bearer ${accessToken}` },
    });

    if (response.status === 401) {
      const data = GetQuoteResponse.parse({ symbol: displaySymbol, error: "unauthorized" });
      return res.json(data);
    }

    if (response.status === 429) {
      req.log.warn({ symbol: displaySymbol }, "Schwab 429 rate limit hit — backing off");
      const data = GetQuoteResponse.parse({ symbol: displaySymbol, error: "rate_limited" });
      return res.status(200).json(data);
    }

    if (!response.ok) {
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

    // ── Robust number extractor ───────────────────────────────────────────────
    // Returns the first key whose value is a finite, non-NaN number.
    // Handles null, undefined, string "NaN", and zero correctly.
    function pickNum(...keys: string[]): number | undefined {
      for (const k of keys) {
        const v = quote[k];
        if (typeof v === "number" && isFinite(v) && !isNaN(v)) return v;
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
      // Schwab uses both "52WeekHigh" and "highPrice52Week" depending on endpoint version
      fiftyTwoWeekHigh: pickNum("52WeekHigh", "highPrice52Week", "52WkHigh", "fiftyTwoWeekHigh"),
      fiftyTwoWeekLow:  pickNum("52WeekLow",  "lowPrice52Week",  "52WkLow",  "fiftyTwoWeekLow"),
      peRatio: (fundamental?.["peRatio"] as number) ?? undefined,
      nextEarningsDate: typeof fundamental?.["nextEarningsDate"] === "string" ? fundamental["nextEarningsDate"] : undefined,
    });

    res.json(data);
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
  const accessToken = req.query["accessToken"] as string;
  let periodType = (req.query["periodType"] as string) ?? "month";
  let period = parseInt((req.query["period"] as string) ?? "3", 10);
  let frequencyType = (req.query["frequencyType"] as string) ?? "daily";
  let frequency = parseInt((req.query["frequency"] as string) ?? "1", 10);

  if (!symbol || !accessToken) {
    return res.json({ symbol: "", candles: [], error: "symbol and accessToken are required" });
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

router.get("/options", async (req, res) => {
  const symbol = req.query["symbol"] as string;
  const accessToken = req.query["accessToken"] as string;
  const contractType = (req.query["contractType"] as string) ?? "ALL";
  const daysToExpiration = Number(req.query["daysToExpiration"] ?? 30);
  const strikeCount = req.query["strikeCount"] ? Number(req.query["strikeCount"]) : undefined;

  if (!symbol || !accessToken) {
    return res.json({ symbol: "", calls: [], puts: [], error: "symbol and accessToken are required" });
  }

  const displaySymbol = symbol.toUpperCase().trim();
  const apiSymbol = formatSchwabSymbol(displaySymbol);

  try {
    const params = new URLSearchParams({
      symbol: apiSymbol,
      contractType,
      daysToExpiration: String(daysToExpiration),
      range: "ALL",
    });

    if (strikeCount && strikeCount > 0) {
      params.set("strikeCount", String(strikeCount));
    }

    const response = await fetch(`${SCHWAB_API_BASE}/chains?${params.toString()}`, {
      headers: { "Authorization": `Bearer ${accessToken}` },
    });

    if (response.status === 401) {
      return res.json({ symbol: displaySymbol, calls: [], puts: [], error: "unauthorized" });
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      req.log.error({ status: response.status, body: errBody, symbol: apiSymbol }, "Options chain API error");
      return res.json({ symbol: displaySymbol, calls: [], puts: [], error: `api_error_${response.status}`, message: errBody });
    }

    const json = await response.json() as Record<string, unknown>;
    const underlyingPrice = json["underlyingPrice"] as number | undefined;

    function parseContracts(map: Record<string, unknown>): Array<{
      strike: number; expiration: string; schwabSymbol?: string; bid?: number; ask?: number; bidSize?: number; askSize?: number; last?: number;
      volume?: number; openInterest?: number; iv?: number; delta?: number;
      gamma?: number; theta?: number; vega?: number; dte?: number;
    }> {
      const contracts: Array<{
        strike: number; expiration: string; schwabSymbol?: string; bid?: number; ask?: number; bidSize?: number; askSize?: number; last?: number;
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
              schwabSymbol: opt["symbol"] as string | undefined,
              bid: opt["bid"] as number | undefined,
              ask: opt["ask"] as number | undefined,
              bidSize: opt["bidSize"] as number | undefined,
              askSize: opt["askSize"] as number | undefined,
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

router.get("/fundamentals", async (req, res) => {
  const symbol = req.query["symbol"] as string;
  const accessToken = req.query["accessToken"] as string;

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

router.get("/earnings-date", async (req, res) => {
  const symbol = (req.query["symbol"] as string || "").toUpperCase().trim();

  if (!symbol) {
    return res.status(400).json({ symbol: "", earningsDate: null });
  }

  const cleanSymbol = symbol.replace(/^\$/, "");

  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(cleanSymbol)}?modules=calendarEvents`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (!response.ok) {
      req.log.warn({ status: response.status, symbol }, "Yahoo earnings fetch failed, trying scrape fallback");

      const pageUrl = `https://finance.yahoo.com/quote/${encodeURIComponent(cleanSymbol)}/`;
      const pageRes = await fetch(pageUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });

      if (pageRes.ok) {
        const html = await pageRes.text();
        const dateMatch = html.match(/Earnings Date.*?(\w{3} \d{1,2}, \d{4})/s);
        if (dateMatch) {
          const parsed = new Date(dateMatch[1]);
          if (!isNaN(parsed.getTime())) {
            const iso = parsed.toISOString().slice(0, 10);
            return res.json({ symbol: cleanSymbol, earningsDate: iso });
          }
        }
      }

      return res.json({ symbol: cleanSymbol, earningsDate: null });
    }

    const json = await response.json() as Record<string, unknown>;
    const result = (json as any)?.quoteSummary?.result?.[0];
    const earnings = result?.calendarEvents?.earnings;
    const earningsDateArr = earnings?.earningsDate;

    if (Array.isArray(earningsDateArr) && earningsDateArr.length > 0) {
      const rawTs = earningsDateArr[0]?.raw;
      if (typeof rawTs === "number") {
        const d = new Date(rawTs * 1000);
        const iso = d.toISOString().slice(0, 10);
        return res.json({ symbol: cleanSymbol, earningsDate: iso });
      }
      const fmt = earningsDateArr[0]?.fmt;
      if (typeof fmt === "string") {
        return res.json({ symbol: cleanSymbol, earningsDate: fmt });
      }
    }

    res.json({ symbol: cleanSymbol, earningsDate: null });
  } catch (err) {
    req.log.error({ err, symbol }, "Earnings date fetch error");
    res.json({ symbol: cleanSymbol, earningsDate: null });
  }
});

router.get("/news", async (req, res) => {
  const symbol = (req.query["symbol"] as string || "").toUpperCase().trim();

  if (!symbol) {
    return res.status(400).json({ articles: [], error: "symbol is required" });
  }

  const apiKey = process.env["FINNHUB_API_KEY"];
  if (!apiKey) {
    return res.status(500).json({ articles: [], error: "FINNHUB_API_KEY not configured" });
  }

  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const toDate = now.toISOString().slice(0, 10);
  const fromDate = oneWeekAgo.toISOString().slice(0, 10);
  const cleanSymbol = symbol.replace(/^\$/, "");

  try {
    const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(cleanSymbol)}&from=${fromDate}&to=${toDate}&token=${apiKey}`;
    const response = await fetch(url);

    if (!response.ok) {
      req.log.warn({ status: response.status, symbol }, "Finnhub news API error");
      return res.json({ articles: [], error: `finnhub_error_${response.status}` });
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

    const articles = (Array.isArray(raw) ? raw : []).slice(0, 50).map(a => ({
      id: a.id,
      source: a.source || "Unknown",
      headline: a.headline || "",
      summary: a.summary || "",
      url: a.url || "",
      image: a.image || "",
      datetime: a.datetime || 0,
      related: a.related || "",
    }));

    res.json({ articles });
  } catch (err) {
    req.log.error({ err, symbol }, "Finnhub news fetch error");
    res.json({ articles: [], error: "internal_error" });
  }
});

export default router;
