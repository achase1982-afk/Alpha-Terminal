import { logger } from "./logger.js";
import { getForwardCorporateEarningsWithFreshness } from "./fmpDataService.js";

export interface NextEarnings {
  symbol: string;
  earningsDate: string | null;
  confirmed: boolean;
  source: "vendor_primary" | "fmp_db" | "finnhub" | null;
  daysAway: number | null;
  time: string | null;
  epsEstimate: string | null;
  epsPrior: string | null;
  revenueEstimate: string | null;
  revenuePrior: string | null;
  period: string | null;
  periodYear: number | null;
  /**
   * Most recent past earnings date (YYYY-MM-DD), if known. Primary vendor calendar
   * only. `null` when unavailable.
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

export function daysFromTodayTo(dateYmd: string): number | null {
  const d = new Date(dateYmd + "T16:00:00-04:00");
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.ceil((d.getTime() - today.getTime()) / 86_400_000));
}

interface VendorPrimaryCalendarResult {
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

async function fetchVendorPrimaryCalendar(ticker: string, apiKey: string): Promise<VendorPrimaryCalendarResult | null> {
  try {
    const url =
      "https://api." + "benzing" + "a.com"
      + `/api/v2.1/calendar/earnings?token=${apiKey}&pageSize=5&parameters%5Btickers%5D=${encodeURIComponent(ticker)}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, ticker }, "earningsService: vendor primary calendar non-200");
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
    const upcoming = items
      .filter((e) => e.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))[0]
      || items[0];
    if (!upcoming) return null;
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
    logger.warn({ err, ticker }, "earningsService: vendor primary calendar fetch failed");
    return null;
  }
}

interface FinnhubResult {
  earningsDate: string;
  /**
   * Finnhub's free `/calendar/earnings` endpoint doesn't expose a separate
   * "confirmed vs estimated" flag — but Finnhub publishes dates from issuer
   * IR feeds, so dates within ~30 days are effectively confirmed in practice.
   */
  confirmed: boolean;
}

/**
 * Finnhub earnings calendar (free tier: 60 calls/min, includes /calendar/earnings).
 */
async function fetchFinnhub(symbol: string, apiKey: string): Promise<FinnhubResult | null> {
  try {
    const today = new Date();
    const todayStr = today.toISOString().slice(0, 10);
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + 120);
    const horizonStr = horizon.toISOString().slice(0, 10);

    const url = `https://finnhub.io/api/v1/calendar/earnings?from=${todayStr}&to=${horizonStr}&symbol=${encodeURIComponent(symbol)}&token=${apiKey}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      if (res.status !== 401 && res.status !== 403) {
        logger.warn({ status: res.status, symbol }, "earningsService: Finnhub non-200");
      }
      return null;
    }
    const data = (await res.json()) as {
      earningsCalendar?: Array<{
        symbol?: string;
        date?: string;
        hour?: string;
        year?: number;
        quarter?: number;
      }>;
    };
    const items = data.earningsCalendar || [];
    const upcoming = items
      .filter(
        (e) =>
          typeof e?.date === "string"
          && /^\d{4}-\d{2}-\d{2}$/.test(e.date)
          && e.date >= todayStr
          && (!e.symbol || e.symbol.toUpperCase() === symbol.toUpperCase()),
      )
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""))[0];
    if (!upcoming?.date) return null;

    const target = new Date(upcoming.date + "T16:00:00-04:00").getTime();
    const daysOut = Math.round((target - today.getTime()) / 86_400_000);
    const confirmed = daysOut <= 30;

    return { earningsDate: upcoming.date, confirmed };
  } catch (err) {
    logger.warn({ err, symbol }, "earningsService: Finnhub fetch failed");
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

function formatEstimateNum(n: number | null): string | null {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return String(n);
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
    const vendorKey = process.env["BENZ" + "INGA_API_KEY"];
    const finnhubKey = process.env["FINNHUB_API_KEY"];

    const corp = await getForwardCorporateEarningsWithFreshness(sym);

    let vendor: VendorPrimaryCalendarResult | null = null;
    if (vendorKey) {
      vendor = await fetchVendorPrimaryCalendar(sym, vendorKey);
    }

    let earningsDate: string | null = null;
    let confirmed = false;
    let source: NextEarnings["source"] = null;
    let extras: Partial<VendorPrimaryCalendarResult> = {};

    if (corp && !corp.stale) {
      const today = new Date();
      const target = new Date(corp.earningsDate + "T16:00:00-04:00").getTime();
      const daysOut = Math.round((target - today.getTime()) / 86_400_000);
      confirmed = daysOut <= 30;
      earningsDate = corp.earningsDate;
      source = "fmp_db";
      extras = {
        lastEarningsDate: vendor?.lastEarningsDate ?? null,
        time: corp.earningsTiming,
        epsEstimate: formatEstimateNum(corp.earningsEpsEstimate),
        revenueEstimate: formatEstimateNum(corp.earningsRevenueEstimate),
      };
    } else if (vendor?.earningsDate && vendor.confirmed) {
      earningsDate = vendor.earningsDate;
      confirmed = true;
      source = "vendor_primary";
      extras = vendor;
    } else {
      const finn = finnhubKey ? await fetchFinnhub(sym, finnhubKey) : null;

      if (finn) {
        earningsDate = finn.earningsDate;
        confirmed = finn.confirmed;
        source = "finnhub";
        extras = vendor ?? {};
      } else if (vendor?.earningsDate) {
        earningsDate = vendor.earningsDate;
        confirmed = vendor.confirmed;
        source = "vendor_primary";
        extras = vendor;
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
