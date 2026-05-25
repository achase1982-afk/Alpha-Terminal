/**
 * Massive/Polygon Fed economy endpoints (api.polygon.io or api.massive.com).
 * @see https://massive.com/docs/rest/economy/inflation
 * @see https://massive.com/docs/rest/economy/labor-market
 */

import { polygonKey } from "./polygonAnalystData.js";
import { logger } from "./logger.js";

const FED_API_BASE = (process.env["POLYGON_FED_API_BASE"] || "https://api.polygon.io").replace(/\/$/, "");

export type FedInflationRow = {
  date: string;
  cpi?: number;
  cpi_core?: number;
  cpi_year_over_year?: number;
  pce?: number;
  pce_core?: number;
  pce_spending?: number;
};

export type FedLaborMarketRow = {
  date: string;
  unemployment_rate?: number;
  labor_force_participation_rate?: number;
  avg_hourly_earnings?: number;
  job_openings?: number;
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export function monthKeyFromFedDate(date: string): string {
  const m = date.match(/^(\d{4})-(\d{2})/);
  if (!m) return date.slice(0, 7);
  return `${m[1]}-${m[2]}`;
}

export function monthKeyFromBlsPeriod(monthName: string, year: string | number): string {
  const idx = MONTH_NAMES.findIndex((n) => n === monthName);
  if (idx < 0) return `${year}-00`;
  return `${year}-${String(idx + 1).padStart(2, "0")}`;
}

function periodLabelFromKey(key: string): { month: string; year: string } {
  const [y, m] = key.split("-");
  const idx = parseInt(m, 10) - 1;
  return {
    month: MONTH_NAMES[idx] ?? m,
    year: y ?? "",
  };
}

function pctMom(cur: number, prev: number): number | null {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev === 0) return null;
  return ((cur - prev) / prev) * 100;
}

function formatPctMom(mom: number): string {
  return `${mom >= 0 ? "+" : ""}${mom.toFixed(1)}%`;
}

function formatPts(diff: number): string {
  return `${diff >= 0 ? "+" : ""}${diff.toFixed(1)} pts`;
}

async function fetchFedPaged<T>(path: string, limit: number): Promise<T[]> {
  const key = polygonKey();
  if (!key) return [];

  const rows: T[] = [];
  let url: string | null =
    `${FED_API_BASE}${path}?limit=${limit}&sort=date.desc&apiKey=${encodeURIComponent(key)}`;

  for (let page = 0; page < 3 && url; page++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      logger.warn({ status: res.status, path }, "Fed economy API request failed");
      break;
    }
    const json = (await res.json()) as { results?: T[]; next_url?: string };
    if (json.results?.length) rows.push(...json.results);
    url = json.next_url ?? null;
  }

  return rows;
}

export async function fetchFedInflationRows(limit = 24): Promise<FedInflationRow[]> {
  try {
    return await fetchFedPaged<FedInflationRow>("/fed/v1/inflation", limit);
  } catch (err) {
    logger.warn({ err }, "Fed inflation fetch failed");
    return [];
  }
}

export async function fetchFedLaborMarketRows(limit = 24): Promise<FedLaborMarketRow[]> {
  try {
    return await fetchFedPaged<FedLaborMarketRow>("/fed/v1/labor-market", limit);
  } catch (err) {
    logger.warn({ err }, "Fed labor-market fetch failed");
    return [];
  }
}

type InflationSeriesLike = Record<string, unknown>;

function buildInflationMomSeries(
  label: string,
  curLevel: number,
  prevLevel: number,
  prevPrevLevel: number | null,
  month: string,
  year: string,
  yoyFromApi?: number,
  yoyPrev?: number
): InflationSeriesLike | null {
  const mom = pctMom(curLevel, prevLevel);
  if (mom == null) return null;
  const prevMom =
    prevPrevLevel != null && Number.isFinite(prevPrevLevel)
      ? pctMom(prevLevel, prevPrevLevel)
      : null;

  const out: InflationSeriesLike = {
    label,
    unit: "percent",
    actual: formatPctMom(mom),
    previous: prevMom != null ? formatPctMom(prevMom) : "N/A",
    change: formatPts(prevMom != null ? mom - prevMom : mom),
    changeRaw: prevMom != null ? mom - prevMom : mom,
    momRaw: mom,
    prevMomRaw: prevMom ?? 0,
    month,
    year,
    level: curLevel.toFixed(1),
    prevLevel: prevLevel.toFixed(1),
    source: "massive",
  };
  if (yoyFromApi != null && Number.isFinite(yoyFromApi)) {
    out.yoy = `${yoyFromApi >= 0 ? "+" : ""}${yoyFromApi.toFixed(1)}%`;
    out.yoyRaw = yoyFromApi;
    if (yoyPrev != null && Number.isFinite(yoyPrev)) {
      out.prevYoy = `${yoyPrev >= 0 ? "+" : ""}${yoyPrev.toFixed(1)}%`;
      out.prevYoyRaw = yoyPrev;
    }
  }
  return out;
}

/** Build CPI headline/core MoM from Fed inflation rows (API returns newest first). */
export function buildCpiMonthsFromFedInflation(rows: FedInflationRow[]): Record<string, Record<string, InflationSeriesLike>> {
  const sorted = [...rows]
    .filter((r) => r.date && Number.isFinite(r.cpi))
    .sort((a, b) => b.date.localeCompare(a.date));

  const byMonth: Record<string, Record<string, InflationSeriesLike>> = {};

  for (let i = 0; i < sorted.length - 1; i++) {
    const curRow = sorted[i];
    const prevRow = sorted[i + 1];
    const prevPrevRow = sorted[i + 2];
    const key = monthKeyFromFedDate(curRow.date);
    const { month, year } = periodLabelFromKey(key);

    const headline = buildInflationMomSeries(
      "CPI All Items",
      curRow.cpi!,
      prevRow.cpi!,
      prevPrevRow?.cpi ?? null,
      month,
      year,
      curRow.cpi_year_over_year,
      prevRow.cpi_year_over_year
    );
    if (!headline) continue;

    const monthData: Record<string, InflationSeriesLike> = { headline };

    if (Number.isFinite(curRow.cpi_core) && Number.isFinite(prevRow.cpi_core)) {
      const core = buildInflationMomSeries(
        "Core CPI (ex Food & Energy)",
        curRow.cpi_core!,
        prevRow.cpi_core!,
        prevPrevRow?.cpi_core ?? null,
        month,
        year
      );
      if (core) monthData.core = core;
    }

    monthData._meta = {
      month,
      year,
      reportUrl: "https://www.bls.gov/news.release/cpi.nr0.htm",
      source: "massive",
    };
    byMonth[key] = monthData;
  }

  return byMonth;
}

function buildPercentLevelSeries(
  label: string,
  cur: number,
  prev: number,
  month: string,
  year: string
): Record<string, unknown> {
  const diff = cur - prev;
  return {
    label,
    unit: "percent",
    actual: `${cur.toFixed(1)}%`,
    previous: `${prev.toFixed(1)}%`,
    change: formatPts(diff),
    changeRaw: diff,
    month,
    year,
    source: "massive",
  };
}

/** Build labor-market fields from Fed rows (newest first). */
export function buildLaborMonthsFromFed(rows: FedLaborMarketRow[]): Record<string, Record<string, unknown>> {
  const sorted = [...rows].filter((r) => r.date).sort((a, b) => b.date.localeCompare(a.date));
  const byMonth: Record<string, Record<string, unknown>> = {};

  for (let i = 0; i < sorted.length - 1; i++) {
    const cur = sorted[i];
    const prev = sorted[i + 1];
    const key = monthKeyFromFedDate(cur.date);
    const { month, year } = periodLabelFromKey(key);
    const monthData: Record<string, unknown> = {
      _meta: { month, year, source: "massive" },
    };

    if (Number.isFinite(cur.unemployment_rate) && Number.isFinite(prev.unemployment_rate)) {
      monthData.unemployment = buildPercentLevelSeries(
        "Unemployment Rate (U-3)",
        cur.unemployment_rate!,
        prev.unemployment_rate!,
        month,
        year
      );
    }
    if (
      Number.isFinite(cur.labor_force_participation_rate) &&
      Number.isFinite(prev.labor_force_participation_rate)
    ) {
      monthData.lfpr = buildPercentLevelSeries(
        "Labor Force Part. Rate",
        cur.labor_force_participation_rate!,
        prev.labor_force_participation_rate!,
        month,
        year
      );
    }
    if (Number.isFinite(cur.avg_hourly_earnings) && Number.isFinite(prev.avg_hourly_earnings)) {
      monthData.earningsMom = {
        label: "Avg Hourly Earnings",
        unit: "dollars",
        actual: `$${cur.avg_hourly_earnings!.toFixed(2)}`,
        previous: `$${prev.avg_hourly_earnings!.toFixed(2)}`,
        change: `${cur.avg_hourly_earnings! >= prev.avg_hourly_earnings! ? "+$" : "-$"}${Math.abs(cur.avg_hourly_earnings! - prev.avg_hourly_earnings!).toFixed(2)}`,
        changeRaw: cur.avg_hourly_earnings! - prev.avg_hourly_earnings!,
        month,
        year,
        source: "massive",
      };
    }

    byMonth[key] = monthData;
  }

  return byMonth;
}

function latestMonthKeyFromResults(results: Record<string, any>): string | null {
  const h = results.headline;
  if (h?.month && h?.year) return monthKeyFromBlsPeriod(h.month, h.year);
  const n = results.nfp;
  if (n?.month && n?.year) return monthKeyFromBlsPeriod(n.month, n.year);
  return null;
}

/** Prefer Massive for the latest month when BLS has not caught up. */
export function mergeMassiveCpiIntoResults(
  blsResults: Record<string, any>,
  fedByMonth: Record<string, Record<string, InflationSeriesLike>>
): Record<string, any> {
  const fedKeys = Object.keys(fedByMonth).sort();
  if (!fedKeys.length) return blsResults;

  const latestFedKey = fedKeys[fedKeys.length - 1]!;
  const blsKey = latestMonthKeyFromResults(blsResults);
  if (blsKey && latestFedKey <= blsKey) return blsResults;

  const out = { ...blsResults, byMonth: { ...(blsResults.byMonth || {}) } };
  const fedLatest = fedByMonth[latestFedKey]!;

  for (const k of ["headline", "core"] as const) {
    if (fedLatest[k]) out[k] = { ...fedLatest[k] };
  }

  out.byMonth[latestFedKey] = {
    ...(out.byMonth[latestFedKey] || {}),
    ...fedLatest,
  };

  const { month, year } = periodLabelFromKey(latestFedKey);
  out._meta = {
    ...(out._meta || {}),
    month,
    year,
    source: "massive",
    massiveAsOf: latestFedKey,
  };

  return out;
}

export function mergeMassiveLaborIntoNfpResults(
  blsResults: Record<string, any>,
  fedByMonth: Record<string, Record<string, unknown>>
): Record<string, any> {
  const fedKeys = Object.keys(fedByMonth).sort();
  if (!fedKeys.length) return blsResults;

  const latestFedKey = fedKeys[fedKeys.length - 1]!;
  const blsKey = latestMonthKeyFromResults(blsResults);
  if (blsKey && latestFedKey <= blsKey) return blsResults;

  const out = { ...blsResults, byMonth: { ...(blsResults.byMonth || {}) } };
  const fedLatest = fedByMonth[latestFedKey]!;

  for (const k of ["unemployment", "lfpr", "earningsMom"] as const) {
    if (fedLatest[k]) out[k] = { ...(fedLatest[k] as object) };
  }

  out.byMonth[latestFedKey] = {
    ...(out.byMonth[latestFedKey] || {}),
    ...fedLatest,
  };

  if (out._meta) {
    out._meta = { ...out._meta, source: "massive", massiveAsOf: latestFedKey };
  }

  return out;
}
