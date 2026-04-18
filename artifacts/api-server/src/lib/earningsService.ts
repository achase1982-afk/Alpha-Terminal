import { logger } from "./logger.js";
import { logFailure } from "./telemetry.js";

export interface NextEarnings {
  symbol: string;
  earningsDate: string | null;
  confirmed: boolean;
  source: "benzinga" | "yahoo" | "polygon" | null;
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
    // Benzinga returns records in descending date order; we need the NEAREST
    // future earnings, not the first record encountered. Sort the future
    // subset ascending and take the head. Falls back to the latest known
    // record only when no future earnings exist (post-print blackout).
    const upcoming = items
      .filter((e) => e.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))[0]
      || items[0];
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

interface PolygonResult {
  earningsDate: string;
  confirmed: boolean;
}

/**
 * Polygon's Benzinga-powered earnings calendar. Available on paid Polygon plan
 * tiers that include the Benzinga news/calendar add-on — otherwise the endpoint
 * returns 401/403/404 and we silently degrade to Benzinga + Yahoo only.
 *
 * Used as a third-source disambiguator when Benzinga is empty or unconfirmed,
 * to catch cases like RIVN where Yahoo returned May 5 (wrong, unconfirmed) but
 * the actual print was April 30.
 */
async function fetchPolygon(symbol: string, apiKey: string): Promise<PolygonResult | null> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const url = `https://api.polygon.io/benzinga/v1/earnings?ticker=${encodeURIComponent(symbol)}&date.gte=${today}&order=asc&limit=5&apiKey=${apiKey}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      // 401/403 = plan tier lacks Benzinga add-on; 404 = endpoint not available.
      // Silently degrade — these are expected on most plans. Other statuses log.
      if (res.status !== 401 && res.status !== 403 && res.status !== 404) {
        logger.warn({ status: res.status, symbol }, "earningsService: Polygon non-200");
      }
      return null;
    }
    const data = (await res.json()) as {
      results?: Array<{
        date?: string;
        date_status?: string;
        date_confirmed?: number | boolean;
        ticker?: string;
      }>;
    };
    const items = data.results || [];
    const upcoming = items
      .filter((e) => typeof e?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.date >= today)
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""))[0];
    if (!upcoming?.date) return null;
    const confirmed =
      upcoming.date_status === "confirmed" ||
      upcoming.date_confirmed === 1 ||
      upcoming.date_confirmed === true;
    return { earningsDate: upcoming.date, confirmed };
  } catch (err) {
    logger.warn({ err, symbol }, "earningsService: Polygon fetch failed");
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
      // Same defensive ordering as the Benzinga path: when more than one
      // earnings date is returned (Yahoo often returns a [start, end] range
      // for unconfirmed prints, and we've seen multi-quarter responses),
      // pick the earliest entry that's >= today, not whichever index 0
      // happens to be.
      const today = new Date().toISOString().slice(0, 10);
      const normalised = arr
        .map((entry: { raw?: number; fmt?: string }) => {
          if (typeof entry?.raw === "number") {
            return new Date(entry.raw * 1000).toISOString().slice(0, 10);
          }
          if (typeof entry?.fmt === "string") return entry.fmt;
          return null;
        })
        .filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d));
      const upcoming = normalised
        .filter((d) => d >= today)
        .sort((a, b) => a.localeCompare(b))[0];
      if (upcoming) return upcoming;
      if (normalised.length > 0) return normalised.sort()[normalised.length - 1];
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
    const polygonKey = process.env["POLYGON_API_KEY"];

    // Always pull Benzinga first (primary). If it returns a CONFIRMED future
    // date we use it directly and skip the disambiguators.
    let benz: BenzingaResult | null = null;
    if (benzKey) {
      benz = await fetchBenzinga(sym, benzKey);
    }

    let earningsDate: string | null = null;
    let confirmed = false;
    let source: NextEarnings["source"] = null;
    let extras: Partial<BenzingaResult> = {};

    if (benz?.earningsDate && benz.confirmed) {
      // Benzinga confirmed — single source of truth.
      earningsDate = benz.earningsDate;
      confirmed = true;
      source = "benzinga";
      extras = benz;
    } else {
      // Benzinga empty or unconfirmed — consult Polygon and Yahoo and apply
      // multi-source agreement logic. Both calls in parallel to avoid serial
      // latency on the cache-miss path.
      const [poly, yahoo] = await Promise.all([
        polygonKey ? fetchPolygon(sym, polygonKey) : Promise.resolve(null),
        fetchYahoo(sym),
      ]);

      const datesWithinDays = (a: string, b: string, n: number): boolean => {
        const da = new Date(a + "T16:00:00-04:00").getTime();
        const db = new Date(b + "T16:00:00-04:00").getTime();
        return Math.abs(da - db) <= n * 86_400_000;
      };

      if (poly && yahoo && datesWithinDays(poly.earningsDate, yahoo, 2)) {
        // Polygon and Yahoo agree (within 2 days). High confidence — use Polygon's
        // confirmed flag (Polygon/Benzinga distinguishes confirmed vs estimate).
        earningsDate = poly.earningsDate;
        confirmed = poly.confirmed;
        source = "polygon";
        extras = benz ?? {};
      } else if (poly) {
        // Polygon disagrees with Yahoo (or Yahoo missing) — prefer Polygon.
        // This is the RIVN case: Yahoo says 2026-05-05 unconfirmed, Polygon
        // says 2026-04-30 confirmed → use Polygon.
        if (yahoo) {
          logger.warn({ symbol: sym, polygon: poly.earningsDate, yahoo }, "earningsService: Polygon/Yahoo disagree, preferring Polygon");
        }
        earningsDate = poly.earningsDate;
        confirmed = poly.confirmed;
        source = "polygon";
        extras = benz ?? {};
      } else if (benz?.earningsDate) {
        // Polygon unavailable, Yahoo unavailable or already preferred-against:
        // fall back to Benzinga's unconfirmed answer.
        earningsDate = benz.earningsDate;
        confirmed = benz.confirmed;
        source = "benzinga";
        extras = benz;
      } else if (yahoo) {
        // Last resort: Yahoo only.
        earningsDate = yahoo;
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
