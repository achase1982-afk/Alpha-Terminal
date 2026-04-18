import { logger } from "./logger.js";
import { logFailure } from "./telemetry.js";

export interface NextEarnings {
  symbol: string;
  earningsDate: string | null;
  confirmed: boolean;
  source: "benzinga" | "yahoo" | null;
  daysAway: number | null;
  time: string | null;
  epsEstimate: string | null;
  epsPrior: string | null;
  revenueEstimate: string | null;
  revenuePrior: string | null;
  period: string | null;
  periodYear: number | null;
  /**
   * Most recent past earnings date (YYYY-MM-DD), if known. Powered by Benzinga
   * only — Yahoo's `quoteSummary` endpoint does not expose past prints
   * reliably. `null` when unavailable.
   */
  lastEarningsDate: string | null;
  /** Calendar days since `lastEarningsDate`, or null when unavailable. */
  lastEarningsDaysSince: number | null;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 30 * 60 * 1000;

interface CacheEntry {
  ts: number;
  value: NextEarnings;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<NextEarnings>>();

function daysFromTodayTo(dateYmd: string): number | null {
  const d = new Date(dateYmd + "T16:00:00-04:00");
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.ceil((d.getTime() - today.getTime()) / 86_400_000));
}

interface BenzingaResult {
  earningsDate: string;
  confirmed: boolean;
  time: string | null;
  epsEstimate: string | null;
  epsPrior: string | null;
  revenueEstimate: string | null;
  revenuePrior: string | null;
  period: string | null;
  periodYear: number | null;
  /** Most recent past earnings date in YYYY-MM-DD, or null. */
  lastEarningsDate: string | null;
}

function daysSinceTodayFrom(dateYmd: string): number | null {
  const d = new Date(dateYmd + "T16:00:00-04:00");
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.floor((today.getTime() - d.getTime()) / 86_400_000);
  return diff < 0 ? null : diff;
}

async function fetchBenzinga(ticker: string, apiKey: string): Promise<BenzingaResult | null> {
  try {
    const url = `https://api.benzinga.com/api/v2.1/calendar/earnings?token=${apiKey}&pageSize=5&parameters%5Btickers%5D=${encodeURIComponent(ticker)}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, ticker }, "earningsService: Benzinga non-200");
      return null;
    }
    const data = (await res.json()) as {
      earnings?: Array<{
        date: string;
        date_confirmed: number;
        time: string;
        ticker: string;
        eps_est: string;
        eps_prior: string;
        revenue_est: string;
        revenue_prior: string;
        period: string;
        period_year: number;
      }>;
    };
    const items = data.earnings || [];
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = items.find((e) => e.date >= today) || items[0];
    if (!upcoming) return null;
    // Most recent past print: latest item with date strictly < today.
    const past = items
      .filter((e) => e.date < today)
      .sort((a, b) => b.date.localeCompare(a.date))[0];
    const lastEarningsDate = past?.date ?? null;

    const timeStr = upcoming.time && upcoming.time !== "00:00:00" ? upcoming.time : null;
    let timingLabel: string | null = null;
    if (timeStr) {
      const hour = parseInt(timeStr.split(":")[0], 10);
      if (hour < 10) timingLabel = "BMO";
      else if (hour >= 16) timingLabel = "AMC";
      else timingLabel = timeStr.slice(0, 5);
    }

    return {
      earningsDate: upcoming.date,
      confirmed: upcoming.date_confirmed === 1,
      time: timingLabel,
      epsEstimate: upcoming.eps_est || null,
      epsPrior: upcoming.eps_prior || null,
      revenueEstimate: upcoming.revenue_est || null,
      revenuePrior: upcoming.revenue_prior || null,
      period: upcoming.period || null,
      periodYear: upcoming.period_year || null,
      lastEarningsDate,
    };
  } catch (err) {
    logger.warn({ err, ticker }, "earningsService: Benzinga fetch failed");
    return null;
  }
}

async function fetchYahoo(symbol: string): Promise<string | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=calendarEvents`;
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      logger.warn({ status: res.status, symbol }, "earningsService: Yahoo non-200, trying scrape");
      void logFailure("YAHOO", "WARN", `Yahoo earnings calendar fetch failed: HTTP ${res.status}`, {
        symbol,
        status: res.status,
      });
      const pageRes = await fetch(`https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}/`, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        signal: AbortSignal.timeout(8000),
      });
      if (pageRes.ok) {
        const html = await pageRes.text();
        const m = html.match(/Earnings Date.*?(\w{3} \d{1,2}, \d{4})/s);
        if (m) {
          const parsed = new Date(m[1]);
          if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
        }
      }
      return null;
    }

    const json = (await res.json()) as Record<string, unknown>;
    const result = (json as any)?.quoteSummary?.result?.[0];
    const arr = result?.calendarEvents?.earnings?.earningsDate;
    if (Array.isArray(arr) && arr.length > 0) {
      const rawTs = arr[0]?.raw;
      if (typeof rawTs === "number") return new Date(rawTs * 1000).toISOString().slice(0, 10);
      const fmt = arr[0]?.fmt;
      if (typeof fmt === "string") return fmt;
    }
    return null;
  } catch (err) {
    logger.error({ err, symbol }, "earningsService: Yahoo fetch error");
    void logFailure("YAHOO", "ERROR", `Yahoo earnings date fetch error for ${symbol}`, {
      symbol,
      error: String(err),
    });
    return null;
  }
}

function emptyResult(sym: string): NextEarnings {
  return {
    symbol: sym,
    earningsDate: null,
    confirmed: false,
    source: null,
    daysAway: null,
    time: null,
    epsEstimate: null,
    epsPrior: null,
    revenueEstimate: null,
    revenuePrior: null,
    period: null,
    periodYear: null,
    lastEarningsDate: null,
    lastEarningsDaysSince: null,
  };
}

export async function getNextEarningsDate(symbol: string): Promise<NextEarnings> {
  const sym = (symbol || "").toUpperCase().trim().replace(/^\$/, "");
  if (!sym) return emptyResult("");

  const cached = cache.get(sym);
  const ttl = cached?.value.earningsDate ? CACHE_TTL_MS : NEGATIVE_TTL_MS;
  if (cached && Date.now() - cached.ts < ttl) {
    return cached.value;
  }

  const existing = inflight.get(sym);
  if (existing) return existing;

  const job = (async (): Promise<NextEarnings> => {
    const benzKey = process.env["BENZINGA_API_KEY"];
    let benz: BenzingaResult | null = null;
    if (benzKey) {
      benz = await fetchBenzinga(sym, benzKey);
    }

    let earningsDate: string | null = null;
    let confirmed = false;
    let source: NextEarnings["source"] = null;
    let extras: Partial<BenzingaResult> = {};

    if (benz?.earningsDate) {
      earningsDate = benz.earningsDate;
      confirmed = benz.confirmed;
      source = "benzinga";
      extras = benz;
    } else {
      const y = await fetchYahoo(sym);
      if (y) {
        earningsDate = y;
        confirmed = false;
        source = "yahoo";
      }
    }

    const lastEarningsDate = extras.lastEarningsDate ?? null;
    const result: NextEarnings = {
      symbol: sym,
      earningsDate,
      confirmed,
      source,
      daysAway: earningsDate ? daysFromTodayTo(earningsDate) : null,
      time: extras.time ?? null,
      epsEstimate: extras.epsEstimate ?? null,
      epsPrior: extras.epsPrior ?? null,
      revenueEstimate: extras.revenueEstimate ?? null,
      revenuePrior: extras.revenuePrior ?? null,
      period: extras.period ?? null,
      periodYear: extras.periodYear ?? null,
      lastEarningsDate,
      lastEarningsDaysSince: lastEarningsDate ? daysSinceTodayFrom(lastEarningsDate) : null,
    };

    cache.set(sym, { ts: Date.now(), value: result });
    return result;
  })();

  inflight.set(sym, job);
  try {
    return await job;
  } finally {
    inflight.delete(sym);
  }
}

export function clearEarningsCache(symbol?: string): void {
  if (symbol) {
    cache.delete(symbol.toUpperCase().trim().replace(/^\$/, ""));
  } else {
    cache.clear();
  }
}
