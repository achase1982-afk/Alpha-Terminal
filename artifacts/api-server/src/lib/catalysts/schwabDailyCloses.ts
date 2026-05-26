import pLimit from "p-limit";
import { getFmpHistoricalPriceEodFull } from "../fmpClient.js";
import { forceRefresh, getBestAccessToken, getValidAccessToken } from "../tokenStore.js";
import { nyCalendarYmd } from "../usEquityMarketCalendar.js";
import { logger } from "../logger.js";

const SCHWAB_API_BASE = "https://api.schwabapi.com/marketdata/v1";
const fetchLimit = pLimit(4);

type Candle = { close: number; datetime: number };

async function resolveSchwabAccessToken(): Promise<string | null> {
  let token = getValidAccessToken("market") ?? getValidAccessToken("trader");
  if (token) return token;
  if (getBestAccessToken()) {
    await forceRefresh("market").catch(() => false);
    token = getValidAccessToken("market") ?? getValidAccessToken("trader");
  }
  return token;
}

function candlesToNyDateMap(candles: Candle[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of candles) {
    if (!Number.isFinite(c.close) || !Number.isFinite(c.datetime)) continue;
    const ymd = nyCalendarYmd(new Date(c.datetime));
    map.set(ymd, c.close);
  }
  return map;
}

async function fetchSchwabCandles(symbol: string, token: string): Promise<Candle[]> {
  const sym = symbol.toUpperCase();
  const params = new URLSearchParams({
    symbol: sym,
    periodType: "month",
    period: "6",
    frequencyType: "daily",
    frequency: "1",
    needExtendedHoursData: "false",
  });
  const res = await fetch(`${SCHWAB_API_BASE}/pricehistory?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) {
    logger.debug({ sym, status: res.status }, "Schwab pricehistory failed");
    return [];
  }
  const json = (await res.json()) as { candles?: Candle[] };
  return json.candles ?? [];
}

async function fetchFmpDailyClosesByNyDate(symbol: string): Promise<Map<string, number>> {
  const sym = symbol.toUpperCase();
  const toYmd = nyCalendarYmd(new Date());
  const from = new Date();
  from.setDate(from.getDate() - 120);
  const fromYmd = nyCalendarYmd(from);
  try {
    const rows = await getFmpHistoricalPriceEodFull(sym, fromYmd, toYmd);
    const map = new Map<string, number>();
    for (const r of rows) {
      const d = String(r.date).slice(0, 10);
      if (r.close != null && Number.isFinite(r.close)) map.set(d, r.close);
    }
    return map;
  } catch (err) {
    logger.debug({ sym, err }, "FMP historical EOD fallback failed");
    return new Map();
  }
}

/**
 * Schwab REST daily closes keyed by NY session date (YYYY-MM-DD).
 * Falls back to FMP EOD when Schwab has no bars (OTC / thin names).
 * Used by Catalysts rebuild only — not page load.
 */
export async function fetchSchwabDailyClosesByNyDate(
  symbol: string,
): Promise<Map<string, number>> {
  const sym = symbol.toUpperCase();
  const token = await resolveSchwabAccessToken();

  if (token) {
    try {
      const candles = await fetchSchwabCandles(sym, token);
      const map = candlesToNyDateMap(candles);
      if (map.size > 0) return map;
    } catch (err) {
      logger.debug({ sym, err }, "Schwab pricehistory error");
    }
  } else {
    logger.warn("Catalysts Schwab drift: no valid access token — using FMP fallback only");
  }

  const fmp = await fetchFmpDailyClosesByNyDate(sym);
  if (fmp.size === 0) {
    logger.debug({ sym }, "No daily closes from Schwab or FMP");
  }
  return fmp;
}

export async function fetchSchwabDailyClosesBatch(
  symbols: string[],
): Promise<Map<string, Map<string, number>>> {
  const unique = [...new Set(symbols.map((s) => s.toUpperCase()))];
  const out = new Map<string, Map<string, number>>();
  await Promise.all(
    unique.map((sym) =>
      fetchLimit(async () => {
        const closes = await fetchSchwabDailyClosesByNyDate(sym);
        out.set(sym, closes);
      }),
    ),
  );
  return out;
}

/** Latest close from daily history (for gate price when profile has no quote). */
export function latestCloseFromMap(closesByDate: Map<string, number>): number | null {
  let bestYmd = "";
  let bestClose: number | null = null;
  for (const [ymd, close] of closesByDate) {
    if (ymd > bestYmd && Number.isFinite(close)) {
      bestYmd = ymd;
      bestClose = close;
    }
  }
  return bestClose;
}
