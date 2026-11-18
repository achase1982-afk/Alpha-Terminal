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

const NULL_RETRY_MS = 5 * 60 * 1000;

let dailyCache: {
  nyDate: string;
  stats: SpxKeepawayStats | null;
  retryAfterMs?: number;
} | null = null;

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

function dropPartialSessionToday(candles: Candle[]): Candle[] {
  const nyToday = nyCalendarYmd(new Date());
  return candles.filter((c) => {
    const ymd = nyCalendarYmd(new Date(c.datetime));
    return ymd < nyToday;
  });
}

export async function getSpxKeepawayStats(): Promise<SpxKeepawayStats | null> {
  const nyDate = nyCalendarYmd(new Date());
  if (dailyCache?.nyDate === nyDate) {
    if (dailyCache.stats) return dailyCache.stats;
    if (dailyCache.retryAfterMs != null && Date.now() < dailyCache.retryAfterMs) {
      return null;
    }
  }

  const token = await resolveMarketToken();
  if (!token) {
    dailyCache = { nyDate, stats: null, retryAfterMs: Date.now() + NULL_RETRY_MS };
    return null;
  }

  try {
    const candles = dropPartialSessionToday(await fetchSpxDailyYtd(token));
    const statsEndYmd =
      candles.length > 0
        ? nyCalendarYmd(new Date(candles[candles.length - 1]!.datetime))
        : nyDate;
    const stats = computeSpxKeepawayFromDailyCandles(
      candles.map((c) => ({ high: c.high, low: c.low, close: c.close })),
      { startYmd: SPX_START_YMD, endYmd: statsEndYmd },
    );
    dailyCache = stats ? { nyDate, stats } : { nyDate, stats: null, retryAfterMs: Date.now() + NULL_RETRY_MS };
    return stats;
  } catch (err) {
    logger.debug({ err }, "SPX keepaway compute failed");
    dailyCache = { nyDate, stats: null, retryAfterMs: Date.now() + NULL_RETRY_MS };
    return null;
  }
}