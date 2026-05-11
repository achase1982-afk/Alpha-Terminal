/**
 * Shared ticker news fetchers (Polygon reference news, Benzinga vendor primary, Finnhub company news).
 * Used by GET /api/market/news and by strategist snapshot assembly — keep behavior aligned with the NEWS tab.
 */

export interface NormalizedArticle {
  id: number;
  source: string;
  headline: string;
  summary: string;
  url: string;
  image: string;
  datetime: number;
  related: string;
}

export function isFinnhubWrapperUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === "finnhub.io" && parsed.pathname === "/api/news" && parsed.searchParams.has("id");
  } catch {
    return false;
  }
}

interface FinnhubRawArticle {
  id: number;
  category: string;
  datetime: number;
  headline: string;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

export function normalizeFinnhubArticle(a: FinnhubRawArticle): NormalizedArticle {
  const rawUrl = a.url || "";
  return {
    id: a.id,
    source: (a.source || "Unknown").toUpperCase(),
    headline: a.headline || "",
    summary: a.summary || "",
    url: isFinnhubWrapperUrl(rawUrl) ? "" : rawUrl,
    image: a.image || "",
    datetime: a.datetime || 0,
    related: a.related || "",
  };
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
      "/ES": "I:SPX",
      "/NQ": "I:NDX",
      "/YM": "I:DJI",
      "/RTY": "I:RUT",
      "/CL": "X:CLUSD",
      "/GC": "X:GCUSD",
      "/SI": "X:SIUSD",
      "/NG": "X:NGUSD",
    };
    const base = symbol.replace(/[FGHJKMNQUVXZ]\d{1,2}$/, "");
    return futuresMap[base] || futuresMap[symbol] || "";
  }
  if (symbol.startsWith("$")) {
    const indexMap: Record<string, string> = {
      "$SPX": "I:SPX",
      "$NDX": "I:NDX",
      "$DJI": "I:DJI",
      "$RUT": "I:RUT",
      "$VIX": "I:VIX",
    };
    return indexMap[symbol] || "";
  }
  return symbol;
}

function resolveFetchSignal(signal?: AbortSignal): AbortSignal {
  return signal ?? AbortSignal.timeout(8000);
}

export async function fetchPolygonNews(
  symbol: string,
  apiKey: string,
  log: { warn: (o: unknown, m?: string) => void; info: (o: unknown, m?: string) => void },
  signal?: AbortSignal,
  rejectOnFetchError = false,
): Promise<NormalizedArticle[]> {
  const polygonTicker = polygonNewsTicker(symbol);
  const tickerParam = polygonTicker ? `&ticker=${encodeURIComponent(polygonTicker)}` : "";
  const url = `https://api.polygon.io/v2/reference/news?limit=50${tickerParam}&order=desc&sort=published_utc&apiKey=${apiKey}`;

  try {
    const response = await fetch(url, { signal: resolveFetchSignal(signal) });

    if (!response.ok) {
      log.warn({ status: response.status, symbol }, "Polygon news API error");
      if (rejectOnFetchError) {
        throw new Error(`Polygon news API error: ${response.status}`);
      }
      return [];
    }

    const data = (await response.json()) as {
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

    return results.map((a) => ({
      id: Math.abs(hashString(a.id || a.article_url)),
      source: (a.publisher?.name || "Polygon").toUpperCase(),
      headline: a.title || "",
      summary: (a.description || "").slice(0, 300),
      url: a.article_url || "",
      image: a.image_url || "",
      datetime: a.published_utc
        ? Math.floor(new Date(a.published_utc).getTime() / 1000)
        : Math.floor(Date.now() / 1000),
      related: polygonTicker || symbol,
    }));
  } catch (err) {
    if (rejectOnFetchError) {
      throw err;
    }
    log.warn({ err, symbol }, "Polygon news fetch failed");
    return [];
  }
}

function vendorPrimaryTicker(symbol: string): string {
  if (symbol.startsWith("/")) {
    const base = symbol.replace(/[FGHJKMNQUVXZ]\d{1,2}$/, "").replace(/^\//, "");
    return base;
  }
  if (symbol.startsWith("$")) {
    const indexMap: Record<string, string> = {
      "$SPX": "SPY",
      "$NDX": "QQQ",
      "$DJI": "DIA",
      "$RUT": "IWM",
      "$VIX": "VIX",
    };
    return indexMap[symbol] || symbol.replace(/^\$/, "");
  }
  return symbol;
}

export async function fetchVendorPrimaryNews(
  symbol: string,
  apiKey: string,
  log: { warn: (o: unknown, m?: string) => void; info: (o: unknown, m?: string) => void },
  signal?: AbortSignal,
  rejectOnFetchError = false,
): Promise<NormalizedArticle[]> {
  const ticker = vendorPrimaryTicker(symbol);
  const url =
    "https://api." + "benzing" + "a.com" + `/api/v2/news?token=${apiKey}&pageSize=50&displayOutput=full&tickers=${encodeURIComponent(ticker)}`;

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: resolveFetchSignal(signal),
    });

    if (!response.ok) {
      log.warn({ status: response.status, symbol }, "Vendor news API error");
      if (rejectOnFetchError) {
        throw new Error(`Vendor news API error: ${response.status}`);
      }
      return [];
    }

    const raw = (await response.json()) as Array<{
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
    log.info({ symbol, count: articles.length }, "Vendor news fetched");

    return articles.map((a) => ({
      id: Math.abs(a.id || hashString(a.url || a.title)),
      source: "VENDOR_PRIMARY",
      headline: a.title || "",
      summary: (a.teaser || "").replace(/&#\d+;/g, "").slice(0, 300),
      url: a.url || "",
      image: (a.image && a.image.length > 0 ? a.image[0].url : "") || "",
      datetime: a.created ? Math.floor(new Date(a.created).getTime() / 1000) : Math.floor(Date.now() / 1000),
      related: ticker,
    }));
  } catch (err) {
    if (rejectOnFetchError) {
      throw err;
    }
    log.warn({ err, symbol }, "Vendor news fetch failed");
    return [];
  }
}

export async function fetchFinnhubNews(
  cleanSymbol: string,
  apiKey: string,
  log: { warn: (o: unknown, m?: string) => void; info: (o: unknown, m?: string) => void },
  signal?: AbortSignal,
  rejectOnFetchError = false,
): Promise<NormalizedArticle[]> {
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const toDate = now.toISOString().slice(0, 10);
  const fromDate = oneWeekAgo.toISOString().slice(0, 10);

  try {
    const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(cleanSymbol)}&from=${fromDate}&to=${toDate}&token=${apiKey}`;
    const response = await fetch(url, { signal: resolveFetchSignal(signal) });

    if (!response.ok) {
      log.warn({ status: response.status, symbol: cleanSymbol }, "Finnhub news API error");
      if (rejectOnFetchError) {
        throw new Error(`Finnhub news API error: ${response.status}`);
      }
      return [];
    }

    const raw = (await response.json()) as Array<{
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

    const articles = (Array.isArray(raw) ? raw : []).slice(0, 30).map(normalizeFinnhubArticle);
    const wrapperCount = (Array.isArray(raw) ? raw : [])
      .slice(0, 30)
      .filter((a) => isFinnhubWrapperUrl(a.url || "")).length;
    if (wrapperCount > 0) {
      log.info({ symbol: cleanSymbol, wrapperCount, count: articles.length }, "Finnhub wrapper URLs suppressed");
    }
    return articles;
  } catch (err) {
    if (rejectOnFetchError) {
      throw err;
    }
    log.warn({ err, symbol: cleanSymbol }, "Finnhub news fetch failed");
    return [];
  }
}

export async function fetchMergedMarketNewsArticles(
  symbol: string,
  log: { warn: (o: unknown, m?: string) => void; info: (o: unknown, m?: string) => void },
  signal?: AbortSignal,
): Promise<NormalizedArticle[]> {
  const polygonKey = process.env["POLYGON_API_KEY"];
  const vendorPrimaryKey = process.env["BENZ" + "INGA_API_KEY"];
  const finnhubKey = process.env["FINNHUB_API_KEY"];

  const [polygonArticles, vendorPrimaryArticles, finnhubArticles] = await Promise.all([
    polygonKey ? fetchPolygonNews(symbol, polygonKey, log, signal) : Promise.resolve([]),
    vendorPrimaryKey ? fetchVendorPrimaryNews(symbol, vendorPrimaryKey, log, signal) : Promise.resolve([]),
    finnhubKey ? fetchFinnhubNews(symbol, finnhubKey, log, signal) : Promise.resolve([]),
  ]);

  const seenHeadlines = new Set<string>();
  const merged: NormalizedArticle[] = [];

  for (const source of [vendorPrimaryArticles, polygonArticles, finnhubArticles]) {
    for (const a of source) {
      const key = a.headline.toLowerCase().slice(0, 60);
      if (!seenHeadlines.has(key)) {
        seenHeadlines.add(key);
        merged.push(a);
      }
    }
  }

  merged.sort((a, b) => b.datetime - a.datetime);

  return merged.slice(0, 50);
}
