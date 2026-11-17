import { deskFormatSchwabSymbol } from "./deskSchwabSymbol.js";
import { deskTouchFeed, deskMarkFeedError, deskMarkAuthFail } from "./deskFeedFreshness.js";
import {
  type DeskSchwabRestApp,
  deskSchwab2MarketFetch,
  deskSchwabMarkApp2AuthFailure,
  deskSchwabRestAccessToken,
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
  app: DeskSchwabRestApp = "app2",
): Promise<{ bars: DeskBar[]; asOfMs: number }> {
  const mapped = mapTimeframe(timeframe);
  if (!mapped) {
    return { bars: [], asOfMs: Date.now() };
  }

  const token = await deskSchwabRestAccessToken(app);
  if (!token) {
    if (app === "app1") deskMarkAuthFail("schwab_quotes_rest");
    return { bars: [], asOfMs: Date.now() };
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
  const fetchFn = app === "app2" ? deskSchwab2MarketFetch : fetch;
  const res = await fetchFn(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });

  if (res.status === 401) {
    if (app === "app1") deskMarkAuthFail("schwab_quotes_rest");
    else deskSchwabMarkApp2AuthFailure(res.status);
    return { bars: [], asOfMs: Date.now() };
  }

  if (!res.ok) {
    if (app === "app1") deskMarkFeedError("schwab_quotes_rest", `pricehistory_${res.status}`);
    else deskMarkFeedError("schwab2_rest", `pricehistory_${res.status}`, "schwab_rest_2");
    return { bars: [], asOfMs: Date.now() };
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
  if (app === "app1") deskTouchFeed("schwab_quotes_rest", asOfMs);
  else deskTouchFeed("schwab2_rest", asOfMs, "schwab_rest_2");
  return { bars, asOfMs };
}