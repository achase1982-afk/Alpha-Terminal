const SCHWAB_API = "https://api.schwabapi.com/marketdata/v1";

interface QuoteResult {
  symbol: string;
  lastPrice: number;
  netPercentChange: number;
  totalVolume: number;
  averageVolume10Day: number;
  highPrice: number;
  lowPrice: number;
}

export interface DynamicWatchlists {
  topMovers: string[];
  volumeSurge: string[];
  highVolatility: string[];
  error?: string;
}

async function fetchQuotesForScreening(
  symbols: string[],
  accessToken: string,
): Promise<QuoteResult[]> {
  const results: QuoteResult[] = [];
  const batchSize = 50;

  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    try {
      const res = await fetch(
        `${SCHWAB_API}/quotes?symbols=${encodeURIComponent(batch.join(","))}&fields=quote`,
        { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000) },
      );
      if (!res.ok) continue;
      const json = (await res.json()) as Record<string, unknown>;
      for (const sym of batch) {
        const entry = json[sym] as Record<string, unknown> | undefined;
        const q = entry?.["quote"] as Record<string, unknown> | undefined;
        if (!q) continue;
        const lastPrice = (q["lastPrice"] as number) ?? 0;
        if (lastPrice <= 0) continue;
        results.push({
          symbol: sym,
          lastPrice,
          netPercentChange: (q["netPercentChangeInDouble"] as number) ?? 0,
          totalVolume: (q["totalVolume"] as number) ?? 0,
          averageVolume10Day: (q["averageVolume10Day"] as number) ?? (q["averageVolume"] as number) ?? 0,
          highPrice: (q["highPrice"] as number) ?? lastPrice,
          lowPrice: (q["lowPrice"] as number) ?? lastPrice,
        });
      }
    } catch {
      continue;
    }
  }

  return results;
}

export async function runDynamicScreener(
  symbols: string[],
  accessToken: string,
  topN = 20,
): Promise<DynamicWatchlists> {
  if (!accessToken) {
    return { topMovers: [], volumeSurge: [], highVolatility: [], error: "No access token" };
  }

  try {
    const quotes = await fetchQuotesForScreening(symbols, accessToken);
    if (quotes.length === 0) {
      return { topMovers: [], volumeSurge: [], highVolatility: [], error: "No quotes returned" };
    }

    const topMovers = [...quotes]
      .sort((a, b) => Math.abs(b.netPercentChange) - Math.abs(a.netPercentChange))
      .slice(0, topN)
      .map(q => q.symbol);

    const hasAvgVolData = quotes.some(q => q.averageVolume10Day > 0);
    const withVolRatio = hasAvgVolData
      ? [...quotes]
          .filter(q => q.averageVolume10Day > 0)
          .map(q => ({ ...q, volRatio: q.totalVolume / q.averageVolume10Day }))
          .sort((a, b) => b.volRatio - a.volRatio)
      : [...quotes]
          .sort((a, b) => b.totalVolume - a.totalVolume)
          .map(q => ({ ...q, volRatio: 1 }));

    const volumeSurge = withVolRatio.slice(0, topN).map(q => q.symbol);

    const withRange = [...quotes]
      .filter(q => q.lowPrice > 0 && q.lastPrice > 0)
      .map(q => ({ ...q, rangePct: ((q.highPrice - q.lowPrice) / q.lastPrice) * 100 }))
      .sort((a, b) => b.rangePct - a.rangePct);

    const highVolatility = (withRange.length >= topN
      ? withRange.slice(0, topN)
      : withRange
    ).map(q => q.symbol);

    return { topMovers, volumeSurge, highVolatility };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { topMovers: [], volumeSurge: [], highVolatility: [], error: msg };
  }
}
