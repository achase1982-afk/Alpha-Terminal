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
  surprisePercentage: number | null;
}

function normaliseSurpriseRow(raw: Record<string, unknown>): FmpEarningsSurpriseRow | null {
  const symbol = pickString(raw["symbol"])?.toUpperCase();
  const dateRaw = pickString(raw["date"]);
  if (!symbol || !dateRaw) return null;
  const date = dateRaw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return {
    symbol,
    date,
    epsActual: pickNumber(raw["epsActual"]),
    epsEstimated: pickNumber(raw["epsEstimated"]),
    surprisePercentage: pickNumber(raw["surprisePercentage"]),
  };
}

export async function getFmpEarningsSurprises(symbol: string, limit: number): Promise<FmpEarningsSurpriseRow[]> {
  const sym = (symbol || "").toUpperCase().trim().replace(/^\$/, "");
  if (!sym) return [];

  const apiKey = getFmpApiKeyOrThrow();
  const params = new URLSearchParams({
    symbol: sym,
    limit: String(Math.max(1, Math.min(100, limit))),
    apikey: apiKey,
  });
  const url = `${FMP_STABLE_BASE}/earnings-surprises?${params.toString()}`;

  const res = await httpLimit(() =>
    fetchWithRetry(url, { headers: { Accept: "application/json" } }),
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    logger.warn({ status: res.status, body: text.slice(0, 300) }, "FMP earnings-surprises non-200");
    return [];
  }

  const data = (await res.json()) as unknown;
  if (!Array.isArray(data)) return [];

  const out: FmpEarningsSurpriseRow[] = [];
  for (const item of data) {
    if (item && typeof item === "object") {
      const row = normaliseSurpriseRow(item as Record<string, unknown>);
      if (row) out.push(row);
    }
  }
  return out;
}
