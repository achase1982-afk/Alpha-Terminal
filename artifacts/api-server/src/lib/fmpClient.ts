import pLimit from "p-limit";
import { logger } from "./logger.js";

const FMP_API_KEY = (process.env["FMP_API_KEY"] ?? "").trim();

export function getFmpApiKeyOrThrow(): string {
  if (!FMP_API_KEY) {
    throw new Error(
      "FMP_API_KEY environment variable is required but was not provided.",
    );
  }
  return FMP_API_KEY;
}

const FMP_STABLE_BASE = "https://financialmodelingprep.com/stable";

/** Parallel HTTP cap for batched FMP calls (Premium ~750 req/min). */
export const FMP_HTTP_CONCURRENCY = 10;
const httpLimit = pLimit(FMP_HTTP_CONCURRENCY);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url: string, opts: RequestInit, retries = 3): Promise<Response> {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(20_000) });
      if (res.status === 429 && i < retries) {
        await sleep(15_000 * (i + 1));
        continue;
      }
      return res;
    } catch (e) {
      if (i === retries) throw e;
      await sleep(2000 * (i + 1));
    }
  }
  throw new Error("fetch exhausted retries");
}

function toYmd(d: Date | string): string {
  if (typeof d === "string") {
    const s = d.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`Invalid date string: ${d}`);
    return s;
  }
  return d.toISOString().slice(0, 10);
}

function pickString(v: unknown): string | null {
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function pickNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export interface FmpEarningsCalendarRow {
  symbol: string;
  date: string;
  time: string | null;
  epsEstimated: number | null;
  revenueEstimated: number | null;
  epsActual?: number | null;
  revenueActual?: number | null;
}

function normaliseEarningsRow(raw: Record<string, unknown>): FmpEarningsCalendarRow | null {
  const symbol = pickString(raw["symbol"])?.toUpperCase();
  const dateRaw = pickString(raw["date"]);
  if (!symbol || !dateRaw) return null;
  const date = dateRaw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const time = pickString(raw["time"]);

  return {
    symbol,
    date,
    time,
    epsEstimated: pickNumber(raw["epsEstimated"]),
    revenueEstimated: pickNumber(raw["revenueEstimated"]),
    epsActual: pickNumber(raw["epsActual"]),
    revenueActual: pickNumber(raw["revenueActual"]),
  };
}

/**
 * FMP stable earnings calendar for [from, to] inclusive (UTC calendar dates).
 */
export async function getFmpEarningsCalendar(from: Date | string, to: Date | string): Promise<FmpEarningsCalendarRow[]> {
  const fromStr = toYmd(from);
  const toStr = toYmd(to);

  const apiKey = getFmpApiKeyOrThrow();
  const params = new URLSearchParams({
    from: fromStr,
    to: toStr,
    apikey: apiKey,
  });
  const url = `${FMP_STABLE_BASE}/earnings-calendar?${params.toString()}`;

  const res = await httpLimit(() =>
    fetchWithRetry(url, { headers: { Accept: "application/json" } }),
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error({ status: res.status, body: text.slice(0, 500) }, "FMP earnings calendar non-200");
    throw new Error(`FMP earnings calendar failed: HTTP ${res.status}`);
  }

  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) {
    throw new Error("FMP earnings calendar: expected JSON array");
  }

  const out: FmpEarningsCalendarRow[] = [];
  for (const item of data) {
    if (item && typeof item === "object") {
      const row = normaliseEarningsRow(item as Record<string, unknown>);
      if (row) out.push(row);
    }
  }
  return out;
}

export interface FmpAnalystPriceTargetConsensus {
  symbol: string;
  targetHigh: number | null;
  targetLow: number | null;
  targetConsensus: number | null;
  targetMedian: number | null;
  numAnalysts: number | null;
}

function normalisePtConsensus(raw: Record<string, unknown>): FmpAnalystPriceTargetConsensus | null {
  const symbol = pickString(raw["symbol"])?.toUpperCase();
  if (!symbol) return null;
  return {
    symbol,
    targetHigh: pickNumber(raw["targetHigh"]),
    targetLow: pickNumber(raw["targetLow"]),
    targetConsensus: pickNumber(raw["targetConsensus"]),
    targetMedian: pickNumber(raw["targetMedian"]),
    numAnalysts: pickNumber(raw["numAnalysts"]),
  };
}

export async function getFmpAnalystPriceTargets(symbol: string): Promise<FmpAnalystPriceTargetConsensus | null> {
  const sym = (symbol || "").toUpperCase().trim().replace(/^\$/, "");
  if (!sym) return null;

  const apiKey = getFmpApiKeyOrThrow();
  const params = new URLSearchParams({ symbol: sym, apikey: apiKey });
  const url = `${FMP_STABLE_BASE}/price-target-consensus?${params.toString()}`;

  const res = await httpLimit(() =>
    fetchWithRetry(url, { headers: { Accept: "application/json" } }),
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.warn({ status: res.status, body: text.slice(0, 300) }, "FMP price-target-consensus non-200");
    return null;
  }

  const data = (await res.json()) as unknown;
  if (!Array.isArray(data) || data.length === 0) return null;
  const first = data[0];
  if (!first || typeof first !== "object") return null;
  return normalisePtConsensus(first as Record<string, unknown>);
}

export interface FmpAnalystGradeRow {
  symbol: string;
  date: string;
  action: string;
  gradingCompany: string | null;
  previousGrade: string | null;
  newGrade: string | null;
}

function normaliseGradeRow(raw: Record<string, unknown>): FmpAnalystGradeRow | null {
  const symbol = pickString(raw["symbol"])?.toUpperCase();
  const dateRaw = pickString(raw["date"]);
  if (!symbol || !dateRaw) return null;
  const date = dateRaw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const action = pickString(raw["action"]);
  if (!action) return null;
  return {
    symbol,
    date,
    action,
    gradingCompany: pickString(raw["gradingCompany"]),
    previousGrade: pickString(raw["previousGrade"]),
    newGrade: pickString(raw["newGrade"]),
  };
}

export async function getFmpAnalystGrades(symbol: string, fromDate: Date): Promise<FmpAnalystGradeRow[]> {
  const sym = (symbol || "").toUpperCase().trim().replace(/^\$/, "");
  if (!sym) return [];

  const apiKey = getFmpApiKeyOrThrow();
  const params = new URLSearchParams({
    symbol: sym,
    from: toYmd(fromDate),
    apikey: apiKey,
  });
  const url = `${FMP_STABLE_BASE}/grades?${params.toString()}`;

  const res = await httpLimit(() =>
    fetchWithRetry(url, { headers: { Accept: "application/json" } }),
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.warn({ status: res.status, body: text.slice(0, 300) }, "FMP grades non-200");
    return [];
  }

  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];

  const out: FmpAnalystGradeRow[] = [];
  for (const item of data) {
    if (item && typeof item === "object") {
      const row = normaliseGradeRow(item as Record<string, unknown>);
      if (row) out.push(row);
    }
  }
  return out;
}

export interface FmpEconomicCalendarRow {
  event: string;
  date: string;
  /** Time portion when FMP returns `YYYY-MM-DD HH:mm:ss` (UTC). */
  eventTime: string | null;
  country: string;
  impact: string | null;
  actual: number | null;
  previous: number | null;
  estimate: number | null;
}

/** Map FMP economic `impact` to calendar importance (macro overlap weighting). */
export function fmpImpactToImportance(impact: string | null): "HIGH" | "MEDIUM" | "LOW" {
  const u = (impact || "").toLowerCase();
  if (u === "high") return "HIGH";
  if (u === "medium") return "MEDIUM";
  return "LOW";
}

function normaliseEconRow(raw: Record<string, unknown>): FmpEconomicCalendarRow | null {
  const event = pickString(raw["event"]);
  const country = pickString(raw["country"]);
  const dateRaw = pickString(raw["date"]);
  if (!event || !country || !dateRaw) return null;
  const date = dateRaw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const eventTime = dateRaw.length > 10 ? dateRaw.slice(11).trim() || null : null;
  return {
    event,
    country,
    date,
    eventTime,
    impact: pickString(raw["impact"]),
    actual: pickNumber(raw["actual"]),
    previous: pickNumber(raw["previous"]),
    estimate: pickNumber(raw["estimate"]),
  };
}

export type FmpEconomicCalendarCountry = "US";

export async function getFmpEconomicCalendar(
  from: Date | string,
  to: Date | string,
  country: FmpEconomicCalendarCountry,
): Promise<FmpEconomicCalendarRow[]> {
  const fromStr = toYmd(from);
  const toStr = toYmd(to);

  const apiKey = getFmpApiKeyOrThrow();
  const params = new URLSearchParams({
    from: fromStr,
    to: toStr,
    country,
    apikey: apiKey,
  });
  const url = `${FMP_STABLE_BASE}/economic-calendar?${params.toString()}`;

  const res = await httpLimit(() =>
    fetchWithRetry(url, { headers: { Accept: "application/json" } }),
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.error({ status: res.status, body: text.slice(0, 500) }, "FMP economic calendar non-200");
    throw new Error(`FMP economic calendar failed: HTTP ${res.status}`);
  }

  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) {
    throw new Error("FMP economic calendar: expected JSON array");
  }

  const out: FmpEconomicCalendarRow[] = [];
  for (const item of data) {
    if (item && typeof item === "object") {
      const row = normaliseEconRow(item as Record<string, unknown>);
      if (row) out.push(row);
    }
  }
  return out;
}

export interface FmpEarningsSurpriseRow {
  symbol: string;
  date: string;
  epsActual: number | null;
  epsEstimated: number | null;
  /** (epsActual - epsEstimated) / |epsEstimated| * 100 when both present and estimate ≠ 0 */
  surprisePercentage: number | null;
  revenueActual: number | null;
  revenueEstimated: number | null;
  /** (revenueActual - revenueEstimated) / |revenueEstimated| * 100 when both present and estimate ≠ 0 */
  revenueSurprisePct: number | null;
}

export interface FmpHistoricalPriceEodRow {
  symbol: string;
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  adjClose: number | null;
}

export interface FmpAnalystEstimateRow {
  symbol: string;
  fiscalPeriodEnd: string;
  epsAvg: number | null;
  epsHigh: number | null;
  epsLow: number | null;
  revenueAvg: number | null;
  revenueHigh: number | null;
  revenueLow: number | null;
  analystCountEps: number | null;
  analystCountRevenue: number | null;
}

function computeEpsSurprisePct(actual: number | null, estimated: number | null): number | null {
  if (actual == null || estimated == null) return null;
  const absEst = Math.abs(estimated);
  if (absEst < 1e-12) return null;
  return ((actual - estimated) / absEst) * 100;
}

function computeRevenueSurprisePct(actual: number | null, estimated: number | null): number | null {
  return computeEpsSurprisePct(actual, estimated);
}

function normaliseEarningsReportRow(raw: Record<string, unknown>): FmpEarningsSurpriseRow | null {
  const symbol = pickString(raw["symbol"])?.toUpperCase();
  const dateRaw = pickString(raw["date"]);
  if (!symbol || !dateRaw) return null;
  const date = dateRaw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const epsActual = pickNumber(raw["epsActual"]) ?? pickNumber(raw["eps"]);
  const epsEstimated = pickNumber(raw["epsEstimated"]) ?? pickNumber(raw["epsEstimate"]);
  const surprisePercentage = computeEpsSurprisePct(epsActual, epsEstimated);

  const revenueActual = pickNumber(raw["revenueActual"]);
  const revenueEstimated = pickNumber(raw["revenueEstimated"]);
  const revenueSurprisePct = computeRevenueSurprisePct(revenueActual, revenueEstimated);

  return {
    symbol,
    date,
    epsActual,
    epsEstimated,
    surprisePercentage,
    revenueActual,
    revenueEstimated,
    revenueSurprisePct,
  };
}

/**
 * Historical earnings with estimate vs actual EPS (FMP "Earnings Report" stable API).
 * @see https://financialmodelingprep.com/stable/earnings?symbol=
 */
export async function getFmpEarningsSurprises(symbol: string, limit: number): Promise<FmpEarningsSurpriseRow[]> {
  const sym = (symbol || "").toUpperCase().trim().replace(/^\$/, "");
  if (!sym) return [];

  const apiKey = getFmpApiKeyOrThrow();
  const params = new URLSearchParams({
    symbol: sym,
    limit: String(Math.max(1, Math.min(100, limit))),
    apikey: apiKey,
  });
  const url = `${FMP_STABLE_BASE}/earnings?${params.toString()}`;

  const res = await httpLimit(() =>
    fetchWithRetry(url, { headers: { Accept: "application/json" } }),
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.warn({ status: res.status, body: text.slice(0, 300) }, "FMP earnings report non-200");
    return [];
  }

  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];

  const out: FmpEarningsSurpriseRow[] = [];
  for (const item of data) {
    if (item && typeof item === "object") {
      const row = normaliseEarningsReportRow(item as Record<string, unknown>);
      if (row) out.push(row);
    }
  }
  return out;
}

function normaliseHistoricalPriceRow(raw: Record<string, unknown>): FmpHistoricalPriceEodRow | null {
  const symbol = pickString(raw["symbol"])?.toUpperCase();
  const dateRaw = pickString(raw["date"]);
  if (!symbol || !dateRaw) return null;
  const date = dateRaw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const close = pickNumber(raw["close"]);
  return {
    symbol,
    date,
    open: pickNumber(raw["open"]),
    high: pickNumber(raw["high"]),
    low: pickNumber(raw["low"]),
    close,
    volume: pickNumber(raw["volume"]),
    /** Documented as split-adjusted series; no separate adjClose on /full — duplicate close when absent. */
    adjClose: pickNumber(raw["adjClose"]) ?? pickNumber(raw["adjustedClose"]) ?? close,
  };
}

/**
 * Full OHLC history for backfills (FMP stable). Prices are split-adjusted per FMP; there is no adjClose column.
 * @see https://financialmodelingprep.com/stable/historical-price-eod/full
 */
export async function getFmpHistoricalPriceEodFull(
  symbol: string,
  fromYmd: string,
  toYmd: string,
): Promise<FmpHistoricalPriceEodRow[]> {
  const sym = (symbol || "").toUpperCase().trim().replace(/^\$/, "");
  if (!sym) return [];

  const apiKey = getFmpApiKeyOrThrow();
  const params = new URLSearchParams({
    symbol: sym,
    from: fromYmd.slice(0, 10),
    to: toYmd.slice(0, 10),
    apikey: apiKey,
  });
  const url = `${FMP_STABLE_BASE}/historical-price-eod/full?${params.toString()}`;

  const res = await httpLimit(() =>
    fetchWithRetry(url, { headers: { Accept: "application/json" } }),
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.warn({ status: res.status, body: text.slice(0, 300) }, "FMP historical-price-eod/full non-200");
    return [];
  }

  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];

  const out: FmpHistoricalPriceEodRow[] = [];
  for (const item of data) {
    if (item && typeof item === "object") {
      const row = normaliseHistoricalPriceRow(item as Record<string, unknown>);
      if (row) out.push(row);
    }
  }
  return out;
}

function normaliseAnalystEstimateRow(raw: Record<string, unknown>): FmpAnalystEstimateRow | null {
  const symbol = pickString(raw["symbol"])?.toUpperCase();
  const dateRaw = pickString(raw["date"]);
  if (!symbol || !dateRaw) return null;
  const fiscalPeriodEnd = dateRaw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fiscalPeriodEnd)) return null;

  return {
    symbol,
    fiscalPeriodEnd,
    epsAvg: pickNumber(raw["estimateEpsAvg"]) ?? pickNumber(raw["epsAvg"]),
    epsHigh: pickNumber(raw["estimateEpsHigh"]) ?? pickNumber(raw["epsHigh"]),
    epsLow: pickNumber(raw["estimateEpsLow"]) ?? pickNumber(raw["epsLow"]),
    revenueAvg: pickNumber(raw["estimateRevenueAvg"]) ?? pickNumber(raw["revenueAvg"]),
    revenueHigh: pickNumber(raw["estimateRevenueHigh"]) ?? pickNumber(raw["revenueHigh"]),
    revenueLow: pickNumber(raw["estimateRevenueLow"]) ?? pickNumber(raw["revenueLow"]),
    analystCountEps:
      pickNumber(raw["numberAnalystsEstimatedEps"])
      ?? pickNumber(raw["numberAnalystEstimatedEps"])
      ?? pickNumber(raw["numAnalystsEps"]),
    analystCountRevenue:
      pickNumber(raw["numberAnalystEstimatedRevenue"])
      ?? pickNumber(raw["numberAnalystsEstimatedRevenue"])
      ?? pickNumber(raw["numAnalystsRevenue"]),
  };
}

async function fetchAnalystEstimatesOnce(
  sym: string,
  period: "quarter" | "annual",
  limit: number,
): Promise<{ rows: FmpAnalystEstimateRow[]; status: number }> {
  const apiKey = getFmpApiKeyOrThrow();
  const params = new URLSearchParams({
    symbol: sym,
    period,
    page: "0",
    limit: String(limit),
    apikey: apiKey,
  });
  const url = `${FMP_STABLE_BASE}/analyst-estimates?${params.toString()}`;

  const res = await httpLimit(() =>
    fetchWithRetry(url, { headers: { Accept: "application/json" } }),
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 402 && period === "quarter") {
      return { rows: [], status: res.status };
    }
    logger.warn(
      { status: res.status, body: text.slice(0, 300), symbol: sym, period },
      "FMP analyst-estimates non-200",
    );
    return { rows: [], status: res.status };
  }

  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return { rows: [], status: res.status };

  const out: FmpAnalystEstimateRow[] = [];
  for (const item of data) {
    if (item && typeof item === "object") {
      const row = normaliseAnalystEstimateRow(item as Record<string, unknown>);
      if (row) out.push(row);
    }
  }
  return { rows: out, status: res.status };
}

/**
 * Quarterly analyst consensus ranges when the FMP plan allows `period=quarter`;
 * otherwise falls back to **annual** rows (`period=annual`, limit capped per plan).
 * @see https://financialmodelingprep.com/stable/analyst-estimates
 */
export async function getFmpAnalystEstimatesQuarterly(
  symbol: string,
  opts?: { page?: number; limit?: number },
): Promise<FmpAnalystEstimateRow[]> {
  const sym = (symbol || "").toUpperCase().trim().replace(/^\$/, "");
  if (!sym) return [];

  const lim = Math.min(100, Math.max(1, opts?.limit ?? 12));
  const q = await fetchAnalystEstimatesOnce(sym, "quarter", lim);
  if (q.rows.length > 0) return q.rows;

  /** Premium-only quarter parameter — fall back to annual (subscription-dependent limit, often ≤10). */
  if (q.status === 402 || q.status === 403) {
    const annualLim = Math.min(lim, 10);
    const a = await fetchAnalystEstimatesOnce(sym, "annual", annualLim);
    return a.rows;
  }

  return [];
}

/** Upcoming dividend calendar row (ex-dividend date + per-share cash amount when present). */
export interface FmpDividendCalendarRow {
  symbol: string;
  /** Ex-dividend calendar date YYYY-MM-DD */
  date: string;
  dividend: number | null;
}

function normaliseDividendCalendarRow(raw: Record<string, unknown>): FmpDividendCalendarRow | null {
  const symbol = pickString(raw["symbol"])?.toUpperCase();
  const dateRaw =
    pickString(raw["date"])
    ?? pickString(raw["exDividendDate"])
    ?? pickString(raw["dividendDate"]);
  if (!symbol || !dateRaw) return null;
  const date = dateRaw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const dividend =
    pickNumber(raw["dividend"])
    ?? pickNumber(raw["adjDividend"])
    ?? pickNumber(raw["cashAmount"])
    ?? pickNumber(raw["payment"]);
  return { symbol, date, dividend };
}

/**
 * Market-wide dividends calendar for [from, to] inclusive (FMP stable).
 * Returns empty array when `FMP_API_KEY` is unset or on non-200 (caller treats as no ex-div data).
 * @see https://financialmodelingprep.com/stable/dividends-calendar
 */
export async function getFmpDividendsCalendar(from: Date | string, to: Date | string): Promise<FmpDividendCalendarRow[]> {
  if (!FMP_API_KEY) return [];

  const fromStr = toYmd(from);
  const toStr = toYmd(to);

  const apiKey = getFmpApiKeyOrThrow();
  const params = new URLSearchParams({
    from: fromStr,
    to: toStr,
    apikey: apiKey,
  });
  const url = `${FMP_STABLE_BASE}/dividends-calendar?${params.toString()}`;

  const res = await httpLimit(() =>
    fetchWithRetry(url, { headers: { Accept: "application/json" } }),
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.warn({ status: res.status, body: text.slice(0, 300) }, "FMP dividends-calendar non-200");
    return [];
  }

  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];

  const out: FmpDividendCalendarRow[] = [];
  for (const item of data) {
    if (item && typeof item === "object") {
      const row = normaliseDividendCalendarRow(item as Record<string, unknown>);
      if (row) out.push(row);
    }
  }
  return out;
}
