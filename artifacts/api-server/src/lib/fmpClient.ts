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

export interface FmpEarningsCalendarRow {
  symbol: string;
  date: string;
  time: string | null;
  epsEstimated: number | null;
  revenueEstimated: number | null;
  /** Raw fields we may ignore but keep for forward compatibility */
  epsActual?: number | null;
  revenueActual?: number | null;
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

function normaliseRow(raw: Record<string, unknown>): FmpEarningsCalendarRow | null {
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
 * FMP stable earnings calendar for [fromDate, toDate] inclusive (YYYY-MM-DD).
 * Uses fetchWithRetry and caps concurrent in-flight HTTP to {@link FMP_HTTP_CONCURRENCY}.
 */
export async function getFmpEarningsCalendar(
  fromDate: string,
  toDate: string,
): Promise<FmpEarningsCalendarRow[]> {
  const from = fromDate.slice(0, 10);
  const to = toDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error(`getFmpEarningsCalendar: invalid date range ${fromDate} — ${toDate}`);
  }

  const apiKey = getFmpApiKeyOrThrow();
  const params = new URLSearchParams({
    from,
    to,
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
      const row = normaliseRow(item as Record<string, unknown>);
      if (row) out.push(row);
    }
  }
  return out;
}
