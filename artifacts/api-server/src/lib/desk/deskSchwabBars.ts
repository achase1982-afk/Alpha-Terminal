import { deskFormatSchwabSymbol } from "./deskSchwabSymbol.js";
import { deskTouchFeed, deskMarkFeedError, deskMarkAuthFail } from "./deskFeedFreshness.js";
import {
  type DeskSchwabRestApp,
  deskSchwab2MarketFetch,
  deskSchwabMarkApp2AuthFailure,
  deskSchwabQuotesFeed,
  deskSchwabRestResolve,
} from "./deskSchwabRestCredential.js";

const SCHWAB_API_BASE = "https://api.schwabapi.com/marketdata/v1";

export type DeskBar = {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

function mapTimeframe(tf: string): {
  periodType: string;
  period: string;
  frequencyType: string;
  frequency: string;
} | null {
  switch (tf) {
    case "1m":
      return { periodType: "day", period: "5", frequencyType: "minute", frequency: "1" };
    case "5m":
      return { periodType: "day", period: "10", frequencyType: "minute", frequency: "5" };
    case "1d":
      return { periodType: "year", period: "1", frequencyType: "daily", frequency: "1" };
    default:
      return null;
  }
}

export async function deskFetchSchwabBars(
  symbol: string,
  timeframe: string,
  limit: number,
  preferred: DeskSchwabRestApp = "app2",
): Promise<{ bars: DeskBar[]; asOfMs: number; app: DeskSchwabRestApp; fellBack: boolean }> {
  const mapped = mapTimeframe(timeframe);
  if (!mapped) {
    return { bars: [], asOfMs: Date.now(), app: preferred, fellBack: false };
  }

  const { token, app, fellBack } = await deskSchwabRestResolve(preferred);
  const feed = deskSchwabQuotesFeed(app);
  if (!token) {
    if (app === "app1") deskMarkAuthFail("schwab_quotes_rest");
    else deskMarkFeedError("schwab2_rest", "schwab2_oauth_required", "schwab_rest_2");
    return { bars: [], asOfMs: Date.now(), app, fellBack };
  }

  const apiSymbol = deskFormatSchwabSymbol(symbol);
  const params = new URLSearchParams({
    symbol: apiSymbol,
    periodType: mapped.periodType,
    period: mapped.period,
    frequencyType: mapped.frequencyType,
    frequency: mapped.frequency,
    needExtendedHoursData: "false",
  });

  const url = `${SCHWAB_API_BASE}/pricehistory?${params.toString()}`;
  const res =
    app === "app2"
      ? await deskSchwab2MarketFetch(url, { headers: { Authorization: `Bearer ${token}` } }, 20_000)
      : await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(20_000),
        });

  if (res.status === 401) {
    if (app === "app1") deskMarkAuthFail("schwab_quotes_rest");
    else deskSchwabMarkApp2AuthFailure(res.status);
    return { bars: [], asOfMs: Date.now(), app, fellBack };
  }

  if (!res.ok) {
    deskMarkFeedError(feed, `pricehistory_${res.status}`, app === "app2" ? "schwab_rest_2" : undefined);
    return { bars: [], asOfMs: Date.now(), app, fellBack };
  }

  const json = (await res.json()) as { candles?: Array<Record<string, unknown>> };
  const raw = json.candles ?? [];
  const capped = raw.slice(-Math.min(Math.max(limit, 1), 500));
  const bars: DeskBar[] = capped.map((c) => ({
    ts: new Date(c["datetime"] as number).toISOString(),
    open: c["open"] as number,
    high: c["high"] as number,
    low: c["low"] as number,
    close: c["close"] as number,
    volume: c["volume"] as number,
  }));

  const asOfMs = bars.length ? Date.parse(bars[bars.length - 1]!.ts) : Date.now();
  deskTouchFeed(feed, asOfMs, app === "app2" ? "schwab_rest_2" : undefined);
  return { bars, asOfMs, app, fellBack };
}