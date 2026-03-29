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
  const bare = upper.endsWith(".X") && upper.startsWith("$") ? upper.slice(0, -2) : upper;
  return bare in INDEX_SYMBOL_MAP;
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
      fiftyTwoWeekHigh: pickNum("52WeekHigh", "highPrice52Week", "52WkHigh", "fiftyTwoWeekHigh"),
      fiftyTwoWeekLow:  pickNum("52WeekLow",  "lowPrice52Week",  "52WkLow",  "fiftyTwoWeekLow"),
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
  const isFuturesSymbol = isFutures(displaySymbol);
  const isIndexSymbol = isIndex(displaySymbol);

  let chainSymbol: string;
  if (isFuturesSymbol) {
    chainSymbol = displaySymbol;
  } else if (isIndexSymbol) {
    chainSymbol = formatSchwabSymbol(displaySymbol);
  } else {
    chainSymbol = displaySymbol;
  }

  try {
    const params = new URLSearchParams({
      symbol: chainSymbol,
      contractType,
      daysToExpiration: String(daysToExpiration),
      range: "ALL",
    });

    if (strikeCount && strikeCount > 0) {
      params.set("strikeCount", String(strikeCount));
    }

    if (isFuturesSymbol) {
      params.set("assetClass", "FUTURES");
    }

    req.log.info({ chainSymbol, isFuturesSymbol, isIndexSymbol, params: params.toString() }, "Options chain request");

    const response = await fetch(`${SCHWAB_API_BASE}/chains?${params.toString()}`, {
      headers: { "Authorization": `Bearer ${accessToken}` },
    });

    if (response.status === 401) {
      return res.json({ symbol: displaySymbol, calls: [], puts: [], error: "unauthorized" });
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      req.log.error({ status: response.status, body: errBody, symbol: chainSymbol }, "Options chain API error");
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

const FUTURES_NAME_MAP: Record<string, string> = {
  "/ES": "S&P 500 futures",
  "/MES": "S&P 500 futures",
  "/NQ": "Nasdaq futures",
  "/MNQ": "Nasdaq futures",
  "/YM": "Dow Jones futures",
  "/MYM": "Dow Jones futures",
  "/RTY": "Russell 2000 futures",
  "/M2K": "Russell 2000 futures",
  "/CL": "crude oil futures",
  "/MCL": "crude oil futures",
  "/GC": "gold futures",
  "/MGC": "gold futures",
  "/SI": "silver futures",
  "/ZB": "treasury bond futures",
  "/ZN": "treasury note futures",
  "/BZ": "Brent crude oil futures",
  "/NG": "natural gas futures",
  "/HG": "copper futures",
  "/6E": "euro futures",
  "/6J": "yen futures",
};

function googleNewsQuery(symbol: string): string {
  const upper = symbol.toUpperCase().trim();
  if (upper.startsWith("/")) {
    const base = upper.replace(/[FGHJKMNQUVXZ]\d{1,2}$/, "");
    return FUTURES_NAME_MAP[base] || FUTURES_NAME_MAP[upper] || `${upper} futures`;
  }
  if (upper.startsWith("$")) return upper.slice(1) + " index stock market";
  return upper + " stock";
}

function extractTag(xml: string, tag: string): string {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  const startIdx = xml.indexOf(open);
  if (startIdx === -1) return "";
  const contentStart = xml.indexOf(">", startIdx);
  if (contentStart === -1) return "";
  const endIdx = xml.indexOf(close, contentStart);
  if (endIdx === -1) return "";
  let content = xml.slice(contentStart + 1, endIdx).trim();
  if (content.startsWith("<![CDATA[") && content.endsWith("]]>")) {
    content = content.slice(9, -3);
  }
  return content;
}

function extractGoogleSource(title: string): { headline: string; source: string } {
  const sepIdx = title.lastIndexOf(" - ");
  if (sepIdx > 0) {
    return {
      headline: title.slice(0, sepIdx).trim(),
      source: title.slice(sepIdx + 3).trim(),
    };
  }
  return { headline: title, source: "Google News" };
}

interface NormalizedArticle {
  id: number;
  source: string;
  headline: string;
  summary: string;
  url: string;
  sourceUrl?: string;
  image: string;
  datetime: number;
  related: string;
}

async function fetchGoogleNews(symbol: string, logger: any): Promise<NormalizedArticle[]> {
  const query = googleNewsQuery(symbol);
  const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(query + " when:1d")}&hl=en-US&gl=US&ceid=US:en`;

  try {
    const response = await fetch(rssUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      logger.warn({ status: response.status, symbol, query }, "Google News RSS error");
      return [];
    }

    const xml = await response.text();
    const items: NormalizedArticle[] = [];
    let searchFrom = 0;

    while (items.length < 30) {
      const itemStart = xml.indexOf("<item>", searchFrom);
      if (itemStart === -1) break;
      const itemEnd = xml.indexOf("</item>", itemStart);
      if (itemEnd === -1) break;
      const itemXml = xml.slice(itemStart, itemEnd + 7);
      searchFrom = itemEnd + 7;

      const rawTitle = extractTag(itemXml, "title");
      const link = extractTag(itemXml, "link");
      const pubDate = extractTag(itemXml, "pubDate");
      const description = extractTag(itemXml, "description");

      const sourceUrlMatch = itemXml.match(/<source\s+url="([^"]+)"/);
      const sourceUrl = sourceUrlMatch?.[1] || "";

      if (!rawTitle || !link) continue;

      const { headline, source } = extractGoogleSource(rawTitle);
      const datetime = pubDate ? Math.floor(new Date(pubDate).getTime() / 1000) : Math.floor(Date.now() / 1000);

      let cleanDesc = description
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ")
        .replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .trim();
      const headlineLower = headline.toLowerCase();
      const descParts = cleanDesc.split(/\s{2,}/);
      cleanDesc = descParts
        .filter(p => p.length > 10 && !p.toLowerCase().startsWith(headlineLower.slice(0, 30)))
        .join(" ")
        .trim();
      if (cleanDesc.length > 300) cleanDesc = cleanDesc.slice(0, 297) + "...";
      if (cleanDesc.length < 10) cleanDesc = "";

      items.push({
        id: Math.abs(hashString(link)),
        source: source.toUpperCase(),
        headline,
        summary: cleanDesc,
        url: link,
        sourceUrl: sourceUrl || undefined,
        image: "",
        datetime,
        related: symbol,
      });
    }

    logger.info({ symbol, query, count: items.length }, "Google News RSS fetched");
    return items;
  } catch (err) {
    logger.warn({ err, symbol }, "Google News RSS fetch failed");
    return [];
  }
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}

async function fetchFinnhubNews(cleanSymbol: string, apiKey: string, logger: any): Promise<NormalizedArticle[]> {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const toDate = now.toISOString().slice(0, 10);
  const fromDate = oneWeekAgo.toISOString().slice(0, 10);

  try {
    const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(cleanSymbol)}&from=${fromDate}&to=${toDate}&token=${apiKey}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });

    if (!response.ok) {
      logger.warn({ status: response.status, symbol: cleanSymbol }, "Finnhub news API error");
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
    logger.warn({ err, symbol: cleanSymbol }, "Finnhub news fetch failed");
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
  const apiKey = process.env["FINNHUB_API_KEY"];

  const [googleArticles, finnhubArticles] = await Promise.all([
    fetchGoogleNews(symbol, req.log),
    apiKey ? fetchFinnhubNews(finnhubSymbol, apiKey, req.log) : Promise.resolve([]),
  ]);

  const seenHeadlines = new Set<string>();
  const merged: NormalizedArticle[] = [];

  for (const a of googleArticles) {
    const key = a.headline.toLowerCase().slice(0, 60);
    if (!seenHeadlines.has(key)) {
      seenHeadlines.add(key);
      merged.push(a);
    }
  }

  for (const a of finnhubArticles) {
    const key = a.headline.toLowerCase().slice(0, 60);
    if (!seenHeadlines.has(key)) {
      seenHeadlines.add(key);
      merged.push(a);
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

router.get("/proxy-article", async (req, res) => {
  const url = req.query.url as string | undefined;
  if (!url) return res.status(400).json({ error: "url required" });

  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return res.status(400).json({ error: "invalid url" });
    }

    const blockedPatterns = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.0\.0\.0|\[::1\])/i;
    if (blockedPatterns.test(parsed.hostname)) {
      return res.status(400).json({ error: "blocked host" });
    }

    const isGoogleNews = url.includes("news.google.com/rss/articles/") || url.includes("news.google.com/articles/");
    const isFinnhub = url.includes("finnhub.io/api/news");

    let articleUrl = url;
    if (isFinnhub) {
      articleUrl = await resolveArticleUrl(url);
    } else if (isGoogleNews) {
      const resolvedFromRedirect = await resolveArticleUrl(url);
      if (resolvedFromRedirect !== url && !resolvedFromRedirect.includes("news.google.com")) {
        articleUrl = resolvedFromRedirect;
      } else {
        const sourceBaseUrl = req.query.sourceUrl as string | undefined;
        const articleTitle = req.query.title as string | undefined;
        if (sourceBaseUrl && articleTitle) {
          const searchUrl = `https://www.google.com/search?q=site:${new URL(sourceBaseUrl).hostname}+"${articleTitle.slice(0, 80)}"&btnI=1`;
          const searchResolved = await resolveArticleUrl(searchUrl);
          if (searchResolved !== searchUrl && !searchResolved.includes("google.com/search")) {
            articleUrl = searchResolved;
          } else {
            articleUrl = sourceBaseUrl;
          }
        }
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
      return res.status(502).json({ error: `upstream ${response.status}` });
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) {
      return res.status(502).json({ error: "not html" });
    }

    const rawHtml = await response.text();

    const { Readability } = await import("@mozilla/readability");
    const { parseHTML } = await import("linkedom");
    const { document: doc } = parseHTML(rawHtml);

    const reader = new Readability(doc as any, { charThreshold: 100 });
    const article = reader.parse();

    const baseObj = new URL(finalUrl);
    const siteName = article?.siteName || baseObj.hostname.replace(/^www\./, "");
    const rawTitle = (req.query.title as string) || article?.title || "Article";
    const rawSource = (req.query.source as string) || siteName;
    const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const title = escHtml(rawTitle);
    const source = escHtml(rawSource);
    const articleContent = article?.content || "<p>Could not extract article content.</p>";

    const readerHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="no-referrer">
  <base href="${baseObj.origin}/" target="_blank">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { background: #1C1C1E; color: #e4e4e7; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
      line-height: 1.75; font-size: 16px; -webkit-font-smoothing: antialiased;
      padding: 20px 16px 80px; max-width: 680px; margin: 0 auto;
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
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(readerHtml);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "fetch failed";
    req.log.error({ err: msg, url }, "proxy-article error");
    res.status(502).json({ error: msg });
  }
});

export default router;
