import { deskFormatSchwabSymbol, deskIsIndex } from "./deskSchwabSymbol.js";
import { deskTouchFeed, deskMarkFeedError, deskMarkAuthFail } from "./deskFeedFreshness.js";
import { deskSessionDateEt } from "./deskEt.js";
import {
  type DeskSchwabRestApp,
  deskSchwabMarkApp2AuthFailure,
  deskSchwabQuotesFeed,
  deskSchwabRestFetch,
} from "./deskSchwabRestCredential.js";
import { deskMarkFeedNotAuthorized } from "./deskFeedFreshness.js";

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
      if (typeof v === "string" && v.trim() !== "") {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
      }
    }
  }
  return null;
}

export async function deskFetchSchwabQuotes(
  symbols: string[],
  preferred: DeskSchwabRestApp = "app2",
): Promise<{
  quotes: DeskQuoteRow[];
  asOfMs: number;
  session_date: string;
  app: DeskSchwabRestApp;
  fellBack: boolean;
}> {
  const session_date = deskSessionDateEt();
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const apiSyms = uniq.map(deskFormatSchwabSymbol);
  const url =
    `${SCHWAB_API_BASE}/quotes?symbols=${encodeURIComponent(apiSyms.join(","))}` +
    "&fields=quote,fundamental,reference";

  const fetched = await deskSchwabRestFetch(preferred, url, { headers: { Accept: "application/json" } }, 15_000);
  const { res, app, fellBack, token } = fetched;
  const feed = deskSchwabQuotesFeed(app);
  if (!token) {
    if (app === "app1") deskMarkAuthFail("schwab_quotes_rest");
    else deskMarkFeedNotAuthorized("schwab2_rest", "schwab2_oauth_required", "schwab_rest_2");
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
      app,
      fellBack,
    };
  }

  if (res.status === 401) {
    if (app === "app1") deskMarkAuthFail("schwab_quotes_rest");
    else deskSchwabMarkApp2AuthFailure(res.status);
    return { quotes: [], asOfMs: Date.now(), session_date, app, fellBack };
  }

  if (!res.ok) {
    if (app === "app1") deskMarkFeedError(feed, `http_${res.status}`);
    else if (res.status === 403) deskSchwabMarkApp2AuthFailure(res.status);
    else deskMarkFeedError("schwab2_rest", `http_${res.status}`, "schwab_rest_2");
    return { quotes: [], asOfMs: Date.now(), session_date, app, fellBack };
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

    const change_pct = index
      ? pickNum(
          srcs,
          "netPercentChangeInDouble",
          "netPercentChange",
          "regularMarketPercentChangeInDouble",
          "regularMarketPercentChange",
          "markPercentChange",
        )
      : pickNum(srcs, "netPercentChangeInDouble", "netPercentChange", "markPercentChange");

    quotes.push({
      symbol: display,
      last: pickNum(srcs, "lastPrice", "last", "mark", "markPrice", "regularMarketLastPrice"),
      bid: index ? null : pickNum(srcs, "bidPrice", "bid"),
      ask: index ? null : pickNum(srcs, "askPrice", "ask"),
      bid_size: index ? null : pickNum(srcs, "bidSize"),
      ask_size: index ? null : pickNum(srcs, "askSize"),
      volume: pickNum(srcs, "totalVolume", "regularMarketVolume"),
      change: pickNum(srcs, "netChange", "regularMarketNetChange", "markChange"),
      change_pct,
      quote_ts: quoteTs,
      trade_ts: tradeTs,
    });
  }

  if (quotes.some((q) => q.last != null)) {
    if (app === "app2") deskTouchFeed("schwab2_rest", latest, "schwab_rest_2");
    else deskTouchFeed("schwab_quotes_rest", latest);
  }
  return { quotes, asOfMs: latest || Date.now(), session_date, app, fellBack };
}
