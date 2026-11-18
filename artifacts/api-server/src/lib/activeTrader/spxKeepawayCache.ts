import {
  computeSpxKeepawayFromDailyCandles,
  type SpxKeepawayStats,
} from "@workspace/order-ticket-math";
import { getValidAccessToken, forceRefresh, getBestAccessToken } from "../tokenStore.js";
import { nyCalendarYmd } from "../usEquityMarketCalendar.js";
import { logger } from "../logger.js";

const SCHWAB_API_BASE = "https://api.schwabapi.com/marketdata/v1";
const SPX_START_YMD = "2026-01-01";

type Candle = { high: number; low: number; close: number; datetime: number };

let dailyCache: { nyDate: string; stats: SpxKeepawayStats | null } | null = null;

async function resolveMarketToken(): Promise<string | null> {
  let token = getValidAccessToken("market") ?? getValidAccessToken("trader");
  if (token) return token;
  if (getBestAccessToken()) {
    await forceRefresh("market").catch(() => false);
    token = getValidAccessToken("market") ?? getValidAccessToken("trader");
  }
  return token ?? null;
}

function ymdToEtStartMs(ymd: string): number {
  return new Date(`${ymd}T00:00:00-05:00`).getTime();
}

async function fetchSpxDailyYtd(token: string): Promise<Candle[]> {
  const endYmd = nyCalendarYmd(new Date());
  const params = new URLSearchParams({
    symbol: "$SPX",
    periodType: "month",
    frequencyType: "daily",
    frequency: "1",
    needExtendedHoursData: "false",
    startDate: String(ymdToEtStartMs(SPX_START_YMD)),
    endDate: String(Date.now()),
  });
  const res = await fetch(`${SCHWAB_API_BASE}/pricehistory?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    logger.debug({ status: res.status }, "SPX keepaway pricehistory failed");
    return [];
  }
  const json = (await res.json()) as { candles?: Candle[] };
  return json.candles ?? [];
}

export async function getSpxKeepawayStats(): Promise<SpxKeepawayStats | null> {
  const nyDate = nyCalendarYmd(new Date());
  if (dailyCache?.nyDate === nyDate) return dailyCache.stats;

  const token = await resolveMarketToken();
  if (!token) {
    dailyCache = { nyDate, stats: null };
    return null;
  }

  try {
    const candles = await fetchSpxDailyYtd(token);
    const stats = computeSpxKeepawayFromDailyCandles(
      candles.map((c) => ({ high: c.high, low: c.low, close: c.close })),
      { startYmd: SPX_START_YMD, endYmd: nyDate },
    );
    dailyCache = { nyDate, stats };
    return stats;
  } catch (err) {
    logger.debug({ err }, "SPX keepaway compute failed");
    dailyCache = { nyDate, stats: null };
    return null;
  }
}