/**
 * Schwab marketdata REST quote — used when streamer cache is cold (chat subscribe-on-miss).
 */
const SCHWAB_MARKETDATA = "https://api.schwabapi.com/marketdata/v1";

export type SchwabRestQuote = {
  symbol: string;
  last: number | null;
  bid: number | null;
  ask: number | null;
  change: number | null;
  changePct: number | null;
  volume: number | null;
  high: number | null;
  low: number | null;
  prevClose: number | null;
};

function pickNum(sources: Array<Record<string, unknown> | undefined>, ...keys: string[]): number | undefined {
  for (const src of sources) {
    if (!src) continue;
    for (const k of keys) {
      const v = src[k];
      if (typeof v === "number" && Number.isFinite(v)) return v;
    }
  }
  return undefined;
}

export async function fetchSchwabRestQuote(
  displaySymbol: string,
  accessToken: string,
): Promise<SchwabRestQuote | null> {
  const sym = displaySymbol.trim().toUpperCase();
  if (!sym || !accessToken.trim()) return null;
  const apiSymbol = sym.startsWith("$") ? sym : sym;
  try {
    const url =
      `${SCHWAB_MARKETDATA}/quotes?symbols=${encodeURIComponent(apiSymbol)}` +
      "&fields=quote,fundamental,reference";
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken.trim()}` },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    const entry = (json[apiSymbol] ?? json[sym] ?? Object.values(json)[0]) as
      | Record<string, unknown>
      | undefined;
    if (!entry) return null;
    const quote = entry["quote"] as Record<string, unknown> | undefined;
    const reference = entry["reference"] as Record<string, unknown> | undefined;
    const fundamental = entry["fundamental"] as Record<string, unknown> | undefined;
    const srcs = [quote, reference, fundamental];

    const last = pickNum(srcs, "lastPrice", "last", "mark", "markPrice", "regularMarketLastPrice") ?? null;
    const prevClose =
      pickNum(srcs, "closePrice", "close", "previousClose", "regularMarketPreviousClose") ?? null;
    let change = pickNum(
      srcs,
      "netChange",
      "regularMarketNetChange",
      "markChange",
      "extendedChange",
      "postMarketChange",
      "preMarketChange",
    );
    let changePct = pickNum(
      srcs,
      "netPercentChange",
      "netPercentChangeInDouble",
      "regularMarketPercentChangeInDouble",
      "markPercentChange",
      "extendedPercentChange",
      "postMarketPercentChange",
      "preMarketChangeInDouble",
    );
    if (change === undefined && last != null && prevClose != null && prevClose !== 0) {
      change = parseFloat((last - prevClose).toFixed(4));
    }
    if (changePct === undefined && change != null && prevClose != null && prevClose !== 0) {
      changePct = parseFloat(((change / prevClose) * 100).toFixed(4));
    }

    return {
      symbol: sym,
      last,
      bid: pickNum(srcs, "bidPrice", "bid") ?? null,
      ask: pickNum(srcs, "askPrice", "ask") ?? null,
      change: change ?? null,
      changePct: changePct ?? null,
      volume: pickNum(srcs, "totalVolume", "volume") ?? null,
      high: pickNum(srcs, "highPrice", "dayHigh", "regularMarketHigh") ?? null,
      low: pickNum(srcs, "lowPrice", "dayLow", "regularMarketLow") ?? null,
      prevClose,
    };
  } catch {
    return null;
  }
}
