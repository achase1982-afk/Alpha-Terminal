import pLimit from "p-limit";
import { getBestAccessToken } from "../tokenStore.js";
import { nyCalendarYmd } from "../usEquityMarketCalendar.js";
import { logger } from "../logger.js";

const SCHWAB_API_BASE = "https://api.schwabapi.com/marketdata/v1";
const fetchLimit = pLimit(6);

type Candle = { close: number; datetime: number };

/**
 * Schwab REST daily closes keyed by NY session date (YYYY-MM-DD).
 * Used by Catalysts rebuild only — not page load.
 */
export async function fetchSchwabDailyClosesByNyDate(
  symbol: string,
): Promise<Map<string, number>> {
  const token = getBestAccessToken();
  if (!token) return new Map();

  const sym = symbol.toUpperCase();
  try {
    const params = new URLSearchParams({
      symbol: sym,
      periodType: "month",
      period: "3",
      frequencyType: "daily",
      frequency: "1",
      needExtendedHoursData: "false",
    });
    const res = await fetch(`${SCHWAB_API_BASE}/pricehistory?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      logger.debug({ sym, status: res.status }, "Schwab pricehistory failed");
      return new Map();
    }
    const json = (await res.json()) as { candles?: Candle[] };
    const map = new Map<string, number>();
    for (const c of json.candles ?? []) {
      if (!Number.isFinite(c.close) || !Number.isFinite(c.datetime)) continue;
      const ymd = nyCalendarYmd(new Date(c.datetime));
      map.set(ymd, c.close);
    }
    return map;
  } catch (err) {
    logger.debug({ sym, err }, "Schwab pricehistory error");
    return new Map();
  }
}

export async function fetchSchwabDailyClosesBatch(
  symbols: string[],
): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  await Promise.all(
    symbols.map((sym) =>
      fetchLimit(async () => {
        const closes = await fetchSchwabDailyClosesByNyDate(sym);
        out.set(sym.toUpperCase(), closes);
      }),
    ),
  );
  return out;
}

/** Latest close from Schwab daily history (for gate price when equity_daily missing). */
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
