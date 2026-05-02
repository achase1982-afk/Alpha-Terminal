/**
 * Polygon Benzinga earnings (api.polygon.io/benzinga/v1/earnings).
 * Earnings history, forward estimates, and reaction fields from equity_daily.
 */

import { eq, sql } from "drizzle-orm";
import { db, corporateEventsTable, equityDailyTable } from "@workspace/db";
import { polygonKey } from "./polygonAnalystData.js";
import { appendPolygonApiTraceRecord } from "./polygonApiTrace.js";
import { fetchRescForwardEstimates } from "./ibkrResc.js";

const POLYGON_BASE = "https://api.polygon.io";
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

const cache = new Map<string, { ts: number; value: FetchEarningsBundle }>();

export type ReportTime = "BMO" | "AMC" | "DMT";

export type EarningsHistoryRow = {
  report_date: string;
  report_time: ReportTime | null;
  fiscal_period: string;
  fiscal_year: string;
  eps_actual: number | null;
  eps_estimate: number | null;
  eps_surprise: number | null;
  eps_surprise_percent: number | null;
  revenue_actual: number | null;
  revenue_estimate: number | null;
  revenue_surprise: number | null;
  revenue_surprise_percent: number | null;
  price_reaction: {
    gap_open_pct: number | null;
    close_to_close_pct: number | null;
    five_day_return_pct: number | null;
    post_earnings_drift_20d_pct: number | null;
  };
  iv_reaction: {
    implied_move_at_close_pct: number | null;
    iv_at_close_pre_earnings: number | null;
    iv_at_close_post_earnings: number | null;
    iv_crush_pct: number | null;
  };
};

export type ForwardEstimatesRow = {
  next_earnings_date: string;
  next_earnings_time: ReportTime | null;
  fiscal_period: string;
  fiscal_year: string;
  eps_consensus: number | null;
  eps_high: number | null;
  eps_low: number | null;
  revenue_consensus: number | null;
  revenue_high: number | null;
  revenue_low: number | null;
  analyst_count: number | null;
};

export type FetchEarningsBundle = {
  earnings_history: EarningsHistoryRow[];
  forward_estimates: ForwardEstimatesRow | null;
  data_source_gaps: string[];
};

type PolygonEarningsApiRow = Record<string, unknown>;

function num(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Calendar date YYYY-MM-DD for split logic (UTC date string). */
function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Map Benzinga time field to BMO / AMC / DMT. Empty or unrecognized returns null.
 */
export function mapReportTime(timeRaw: string | null | undefined): ReportTime | null {
  if (timeRaw == null || String(timeRaw).trim() === "") return null;
  const u = String(timeRaw).trim().toUpperCase();
  if (u === "BMO") return "BMO";
  if (u === "AMC") return "AMC";
  if (u === "DMT") return "DMT";
  if (/BEFORE\s*MARKET|PRE[\s-]*MARKET|PRE[\s-]*OPEN/i.test(u)) return "BMO";
  if (/AFTER\s*MARKET|POST[\s-]*MARKET|AFTER[\s-]*CLOSE/i.test(u)) return "AMC";
  if (/DURING\s*MARKET|INTRA\s*DAY|DMT/i.test(u)) return "DMT";
  const m = u.match(/(\d{1,2}):(\d{2})/);
  if (m) {
    const hour = parseInt(m[1]!, 10);
    if (hour < 10) return "BMO";
    if (hour >= 16) return "AMC";
    return "DMT";
  }
  return null;
}

/**
 * Implied move from ATM IV: single-name rule of thumb, IV as annualized decimal
 * (e.g. 0.30) times sqrt(7/365) for one week as fraction of spot, then percent.
 * This is an approximation for narrative context only.
 */
function impliedMoveOneWeekFromIv(ivDecimal: number | null): number | null {
  if (ivDecimal == null || !Number.isFinite(ivDecimal) || ivDecimal <= 0) return null;
  return ivDecimal * Math.sqrt(7 / 365) * 100;
}

interface EquityDailySlice {
  date: string;
  open: number | null;
  close: number | null;
  iv30d: number | null;
}

/** Next calendar trading session date strictly after reportDate from sorted ascending dates. */
function nextTradingSessionDate(sortedAsc: string[], reportDate: string): string | null {
  for (const d of sortedAsc) {
    if (d > reportDate) return d;
  }
  return null;
}

/** Last trading date strictly before ref in sorted ascending list. */
function priorTradingDate(sortedAsc: string[], ref: string): string | null {
  let prev: string | null = null;
  for (const d of sortedAsc) {
    if (d >= ref) break;
    prev = d;
  }
  return prev;
}

/** Date offset by N trading sessions forward from ref (ref must be in list). */
function tradingDateOffset(sortedAsc: string[], ref: string, deltaSessions: number): string | null {
  const idx = sortedAsc.indexOf(ref);
  if (idx < 0) return null;
  const j = idx + deltaSessions;
  return j >= 0 && j < sortedAsc.length ? sortedAsc[j]! : null;
}

function rowByDate(map: Map<string, EquityDailySlice>, ymd: string): EquityDailySlice | null {
  return map.get(ymd) ?? null;
}

function isFullReaction(row: EarningsHistoryRow): boolean {
  const p = row.price_reaction;
  const v = row.iv_reaction;
  return (
    p.gap_open_pct != null
    && p.close_to_close_pct != null
    && p.five_day_return_pct != null
    && p.post_earnings_drift_20d_pct != null
    && v.implied_move_at_close_pct != null
    && v.iv_at_close_pre_earnings != null
    && v.iv_at_close_post_earnings != null
    && v.iv_crush_pct != null
  );
}

async function loadEquityDailySeries(symbol: string): Promise<EquityDailySlice[]> {
  const rows = await db
    .select({
      date: equityDailyTable.date,
      open: equityDailyTable.open,
      close: equityDailyTable.close,
      iv30d: equityDailyTable.iv30d,
    })
    .from(equityDailyTable)
    .where(eq(equityDailyTable.symbol, symbol))
    .orderBy(equityDailyTable.date);
  return rows.map((r) => ({
    date: typeof r.date === "string" ? r.date : String(r.date),
    open: r.open,
    close: r.close,
    iv30d: r.iv30d,
  }));
}

function buildHistoryRow(
  apiRow: PolygonEarningsApiRow,
  series: EquityDailySlice[],
): EarningsHistoryRow {
  const report_date =
    str(apiRow["date"])?.slice(0, 10)
    ?? "";
  const fiscal_period = str(apiRow["fiscal_period"]) ?? "";
  const fiscal_year = str(apiRow["fiscal_year"]) ?? String(apiRow["fiscal_year"] ?? "");

  const rawTime = str(apiRow["time"]);
  const report_time = mapReportTime(rawTime);

  const sortedDates = [...new Set(series.map((s) => s.date))].sort();

  let anchor = report_date;
  if (report_time === "AMC" || report_time === "DMT" || report_time === null) {
    const nxt = nextTradingSessionDate(sortedDates, report_date);
    anchor = nxt ?? anchor;
  }

  const dateToRow = new Map<string, EquityDailySlice>();
  for (const s of series) dateToRow.set(s.date, s);

  const priorDate = priorTradingDate(sortedDates, anchor);
  const priorRow = priorDate ? rowByDate(dateToRow, priorDate) : null;
  const anchorRow = rowByDate(dateToRow, anchor);
  const fiveDate = tradingDateOffset(sortedDates, anchor, 5);
  const twentyDate = tradingDateOffset(sortedDates, anchor, 20);
  const fiveRow = fiveDate ? rowByDate(dateToRow, fiveDate) : null;
  const twentyRow = twentyDate ? rowByDate(dateToRow, twentyDate) : null;

  const prior_close = priorRow?.close ?? null;
  const reaction_open = anchorRow?.open ?? null;
  const reaction_close = anchorRow?.close ?? null;
  const five_close = fiveRow?.close ?? null;
  const twenty_close = twentyRow?.close ?? null;

  const gap_open_pct =
    prior_close != null && prior_close > 0 && reaction_open != null
      ? (reaction_open / prior_close - 1) * 100
      : null;
  const close_to_close_pct =
    prior_close != null && prior_close > 0 && reaction_close != null
      ? (reaction_close / prior_close - 1) * 100
      : null;
  const five_day_return_pct =
    prior_close != null && prior_close > 0 && five_close != null
      ? (five_close / prior_close - 1) * 100
      : null;
  const post_earnings_drift_20d_pct =
    reaction_close != null && reaction_close > 0 && twenty_close != null
      ? (twenty_close / reaction_close - 1) * 100
      : null;

  const iv_pre = priorRow?.iv30d ?? null;
  const iv_post = anchorRow?.iv30d ?? null;
  const implied_move_at_close_pct = impliedMoveOneWeekFromIv(iv_pre);
  const iv_crush_pct =
    iv_pre != null && iv_pre > 0 && iv_post != null
      ? ((iv_pre - iv_post) / iv_pre) * 100
      : null;

  return {
    report_date,
    report_time,
    fiscal_period,
    fiscal_year,
    eps_actual: num(apiRow["actual_eps"]),
    eps_estimate: num(apiRow["estimated_eps"]),
    eps_surprise: num(apiRow["eps_surprise"]),
    eps_surprise_percent: num(apiRow["eps_surprise_percent"]),
    revenue_actual: num(apiRow["actual_revenue"]),
    revenue_estimate: num(apiRow["estimated_revenue"]),
    revenue_surprise: num(apiRow["revenue_surprise"]),
    revenue_surprise_percent: num(apiRow["revenue_surprise_percent"]),
    price_reaction: {
      gap_open_pct,
      close_to_close_pct,
      five_day_return_pct,
      post_earnings_drift_20d_pct,
    },
    iv_reaction: {
      implied_move_at_close_pct,
      iv_at_close_pre_earnings: iv_pre,
      iv_at_close_post_earnings: iv_post,
      iv_crush_pct,
    },
  };
}

async function upsertCorporateEventsRows(symbol: string, rows: PolygonEarningsApiRow[]): Promise<void> {
  const sym = symbol.toUpperCase().trim();
  for (const r of rows) {
    const d = str(r["date"])?.slice(0, 10);
    if (!d) continue;
    const t = str(r["time"]);
    await db.insert(corporateEventsTable)
      .values({
        symbol: sym,
        earningsDate: d,
        earningsTiming: t,
        updatedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [corporateEventsTable.symbol, corporateEventsTable.earningsDate],
        set: {
          earningsTiming: sql`excluded.earnings_timing`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
}

const REST_GAP_EPS = "rest_subscription_required: forward_eps_high_low";
const REST_GAP_REV = "rest_subscription_required: forward_revenue_high_low";
const REST_GAP_ANALYST = "rest_subscription_required: forward_analyst_count";

export async function fetchEarningsHistoryAndForward(ticker: string): Promise<FetchEarningsBundle> {
  const sym = ticker.trim().toUpperCase().replace(/^\$/, "");
  const cacheKey = sym;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
    return hit.value;
  }

  const gaps: string[] = [REST_GAP_EPS, REST_GAP_REV, REST_GAP_ANALYST];
  const key = polygonKey();
  if (!key || !sym) {
    gaps.push("polygon_benzinga_no_data");
    const empty: FetchEarningsBundle = {
      earnings_history: [],
      forward_estimates: null,
      data_source_gaps: gaps,
    };
    cache.set(cacheKey, { ts: Date.now(), value: empty });
    return empty;
  }

  let httpStatus = 0;
  let apiRows: PolygonEarningsApiRow[] = [];
  let earningsPathForTrace = "/benzinga/v1/earnings";
  try {
    const url =
      `${POLYGON_BASE}/benzinga/v1/earnings?ticker=${encodeURIComponent(sym)}&limit=20&apiKey=${encodeURIComponent(key)}`;
    earningsPathForTrace = (() => {
      try {
        const u = new URL(url.replace(/\bapiKey=[^&]+/i, "apiKey=[REDACTED]"));
        return u.pathname + u.search;
      } catch {
        return "/benzinga/v1/earnings";
      }
    })();
    const t0 = Date.now();
    let timedOut = false;
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    appendPolygonApiTraceRecord({
      path: earningsPathForTrace,
      method: "GET",
      statusCode: res.status,
      responseTimeMs: Date.now() - t0,
      saw429: res.status === 429,
      timedOut,
    });
    httpStatus = res.status;
    if (!res.ok) {
      gaps.push(`polygon_http_error_${httpStatus}`);
      const bundle: FetchEarningsBundle = { earnings_history: [], forward_estimates: null, data_source_gaps: gaps };
      cache.set(cacheKey, { ts: Date.now(), value: bundle });
      return bundle;
    }
    const json = (await res.json()) as { results?: PolygonEarningsApiRow[] };
    apiRows = Array.isArray(json.results) ? json.results : [];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/abort|timeout/i.test(msg)) {
      appendPolygonApiTraceRecord({
        path: earningsPathForTrace,
        method: "GET",
        statusCode: null,
        responseTimeMs: 0,
        timedOut: true,
      });
    }
    gaps.push(`polygon_http_error_${httpStatus || 0}`);
    const bundle: FetchEarningsBundle = { earnings_history: [], forward_estimates: null, data_source_gaps: gaps };
    cache.set(cacheKey, { ts: Date.now(), value: bundle });
    return bundle;
  }

  if (apiRows.length === 0) {
    gaps.push("polygon_benzinga_no_data");
    const bundle: FetchEarningsBundle = { earnings_history: [], forward_estimates: null, data_source_gaps: gaps };
    cache.set(cacheKey, { ts: Date.now(), value: bundle });
    return bundle;
  }

  void upsertCorporateEventsRows(sym, apiRows).catch(() => undefined);

  const today = todayYmd();
  const sortedDesc = [...apiRows].sort((a, b) => {
    const da = str(a["date"]) ?? "";
    const db = str(b["date"]) ?? "";
    return db.localeCompare(da);
  });

  const forwardRaw = sortedDesc.filter((r) => {
    const d = str(r["date"])?.slice(0, 10);
    return d != null && d >= today;
  });
  const historicalRaw = sortedDesc.filter((r) => {
    const d = str(r["date"])?.slice(0, 10);
    return d != null && d < today;
  });

  const historicalTake = historicalRaw.slice(0, 16);
  const series = await loadEquityDailySeries(sym);
  const earnings_history = historicalTake.map((r) => buildHistoryRow(r, series));

  const fullCount = earnings_history.filter(isFullReaction).length;
  if (earnings_history.length > 0) {
    gaps.push(`equity_daily_history_insufficient: ${fullCount} of 16 quarters have full reaction data`);
  }

  let forward_estimates: ForwardEstimatesRow | null = null;
  if (forwardRaw.length > 0) {
    const upcomingSorted = [...forwardRaw].sort((a, b) => {
      const da = str(a["date"])?.slice(0, 10) ?? "9999-99-99";
      const db = str(b["date"])?.slice(0, 10) ?? "9999-99-99";
      return da.localeCompare(db);
    });
    const nearest = upcomingSorted[0]!;
    const ned = str(nearest["date"])?.slice(0, 10) ?? "";
    forward_estimates = {
      next_earnings_date: ned,
      next_earnings_time: mapReportTime(str(nearest["time"])),
      fiscal_period: str(nearest["fiscal_period"]) ?? "",
      fiscal_year: str(nearest["fiscal_year"]) ?? String(nearest["fiscal_year"] ?? ""),
      eps_consensus: num(nearest["estimated_eps"]),
      eps_high: null,
      eps_low: null,
      revenue_consensus: num(nearest["estimated_revenue"]),
      revenue_high: null,
      revenue_low: null,
      analyst_count: null,
    };

    const resc = await fetchRescForwardEstimates(sym);
    if (resc) {
      if (resc.eps_high != null) forward_estimates.eps_high = resc.eps_high;
      if (resc.eps_low != null) forward_estimates.eps_low = resc.eps_low;
      if (resc.revenue_high != null) forward_estimates.revenue_high = resc.revenue_high;
      if (resc.revenue_low != null) forward_estimates.revenue_low = resc.revenue_low;
      if (resc.analyst_count != null) forward_estimates.analyst_count = resc.analyst_count;
    }
  }

  const bundle: FetchEarningsBundle = {
    earnings_history,
    forward_estimates,
    data_source_gaps: gaps,
  };
  cache.set(cacheKey, { ts: Date.now(), value: bundle });
  return bundle;
}
