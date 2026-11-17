import { getBestAccessToken } from "../tokenStore.js";
import { deskFormatSchwabSymbol, deskIsIndex } from "./deskSchwabSymbol.js";
import { deskTouchFeed, deskMarkFeedError, deskMarkAuthFail } from "./deskFeedFreshness.js";
import { deskSessionDateEt } from "./deskEt.js";

const SCHWAB_API_BASE = "https://api.schwabapi.com/marketdata/v1";

export type DeskQuoteRow = {
  symbol: string;
  last: number | null;
  bid: number | null;
  ask: number | null;
  bid_size: number | null;
  ask_size: number | null;
  volume: number | null;
  change: number | null;
  change_pct: number | null;
  quote_ts: number | null;
  trade_ts: number | null;
};

function pickNum(sources: Array<Record<string, unknown> | undefined>, ...keys: string[]): number | null {
  for (const src of sources) {
    if (!src) continue;
    for (const k of keys) {
      const v = src[k];
      if (typeof v === "number" && Number.isFinite(v)) return v;
    }
  }
  return null;
}

export async function deskFetchSchwabQuotes(symbols: string[]): Promise<{
  quotes: DeskQuoteRow[];
  asOfMs: number;
  session_date: string;
}> {
  const token = getBestAccessToken();
  const session_date = deskSessionDateEt();
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (!token) {
    deskMarkAuthFail("schwab_quotes_rest");
    return {
      quotes: uniq.map((symbol) => ({
        symbol,
        last: null,
        bid: null,
        ask: null,
        bid_size: null,
        ask_size: null,
        volume: null,
        change: null,
        change_pct: null,
        quote_ts: null,
        trade_ts: null,
      })),
      asOfMs: Date.now(),
      session_date,
    };
  }

  const apiSyms = uniq.map(deskFormatSchwabSymbol);
  const url =
    `${SCHWAB_API_BASE}/quotes?symbols=${encodeURIComponent(apiSyms.join(","))}` +
    "&fields=quote,fundamental,reference";

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });

  if (res.status === 401) {
    deskMarkAuthFail("schwab_quotes_rest");
    return { quotes: [], asOfMs: Date.now(), session_date };
  }

  if (!res.ok) {
    deskMarkFeedError("schwab_quotes_rest", `http_${res.status}`);
    return { quotes: [], asOfMs: Date.now(), session_date };
  }

  const json = (await res.json()) as Record<string, unknown>;
  let latest = 0;
  const quotes: DeskQuoteRow[] = [];

  for (let i = 0; i < uniq.length; i++) {
    const display = uniq[i]!;
    const apiSym = apiSyms[i]!;
    const entry = (json[apiSym] ?? json[display]) as Record<string, unknown> | undefined;
    const quote = entry?.["quote"] as Record<string, unknown> | undefined;
    const reference = entry?.["reference"] as Record<string, unknown> | undefined;
    const srcs = [quote, reference];
    const index = deskIsIndex(display);

    const quoteTs = pickNum(srcs, "quoteTime") ?? pickNum(srcs, "tradeTime");
    const tradeTs = pickNum(srcs, "tradeTime");
    const ts = quoteTs ?? tradeTs ?? Date.now();
    latest = Math.max(latest, ts);

    quotes.push({
      symbol: display,
      last: pickNum(srcs, "lastPrice", "last", "mark", "markPrice"),
      bid: index ? null : pickNum(srcs, "bidPrice", "bid"),
      ask: index ? null : pickNum(srcs, "askPrice", "ask"),
      bid_size: index ? null : pickNum(srcs, "bidSize"),
      ask_size: index ? null : pickNum(srcs, "askSize"),
      volume: pickNum(srcs, "totalVolume", "regularMarketVolume"),
      change: pickNum(srcs, "netChange", "markChange"),
      change_pct: pickNum(srcs, "netPercentChangeInDouble", "markPercentChange"),
      quote_ts: quoteTs,
      trade_ts: tradeTs,
    });
  }

  if (quotes.some((q) => q.last != null)) deskTouchFeed("schwab_quotes_rest", latest);
  return { quotes, asOfMs: latest || Date.now(), session_date };
}