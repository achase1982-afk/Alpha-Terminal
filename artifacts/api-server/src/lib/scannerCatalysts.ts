/**
 * Scanner Layer 4 — upcoming earnings / ex-dividend + last-four-quarter earnings reactions.
 *
 * - Next earnings: {@link getNextEarningsDate} (corporate_events → vendor → Finnhub fallback).
 * - Ex-dividend: batched FMP `dividends-calendar`, earliest ex-date per symbol in range.
 * - Reactions: Polygon Benzinga earnings history joined to `equity_daily` closes
 *   (`close_to_close_pct` in {@link fetchEarningsHistoryAndForward}, same session logic as Strategist).
 */

import pLimit from "p-limit";
import { daysFromTodayTo, getNextEarningsDate } from "./earningsService.js";
import { fetchEarningsHistoryAndForward } from "./polygonEarningsHistory.js";
import { getFmpDividendsCalendar } from "./fmpClient.js";

const CATALYST_FETCH_CONCURRENCY = 8;

/** Normalized Layer 4 fields merged onto GET /api/scanner/v3/universe card rows (snake_case wire). */
export type ScannerCatalystsWire = {
  next_earnings_date: string | null;
  earnings_timing_hint: "BMO" | "AMC" | null;
  days_to_earnings: number | null;
  next_ex_dividend_date: string | null;
  ex_dividend_amount: number | null;
  days_to_ex_dividend: number | null;
  /** Four percent changes, oldest quarter first — matches {@link polygonEarningsHistory} close-to-close rule. */
  reactions_last_4q: number[] | null;
};

const EMPTY_WIRE: ScannerCatalystsWire = {
  next_earnings_date: null,
  earnings_timing_hint: null,
  days_to_earnings: null,
  next_ex_dividend_date: null,
  ex_dividend_amount: null,
  days_to_ex_dividend: null,
  reactions_last_4q: null,
};

/**
 * Map corporate / vendor time strings to BMO / AMC for scanner UI.
 * (Vendor returns `BMO`/`AMC` or `HH:MM`.)
 */
function earningsTimingHintFromTimeString(time: string | null): "BMO" | "AMC" | null {
  if (time == null || String(time).trim() === "") return null;
  const u = String(time).trim().toUpperCase();
  if (u === "BMO") return "BMO";
  if (u === "AMC") return "AMC";
  const m = String(time).match(/(\d{1,2}):(\d{2})/);
  if (m) {
    const hour = parseInt(m[1]!, 10);
    if (hour < 10) return "BMO";
    if (hour >= 16) return "AMC";
  }
  return null;
}

async function buildNextExDivMap(symbols: string[]): Promise<Map<string, { date: string; amount: number | null }>> {
  const out = new Map<string, { date: string; amount: number | null }>();
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (uniq.length === 0) return out;

  const today = new Date();
  const todayYmd = today.toISOString().slice(0, 10);
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 180);
  const toYmd = horizon.toISOString().slice(0, 10);

  let calendar: Awaited<ReturnType<typeof getFmpDividendsCalendar>> = [];
  try {
    calendar = await getFmpDividendsCalendar(todayYmd, toYmd);
  } catch {
    return out;
  }

  for (const sym of uniq) {
    const candidates = calendar.filter((r) => r.symbol === sym && r.date >= todayYmd);
    if (candidates.length === 0) continue;
    candidates.sort((a, b) => a.date.localeCompare(b.date));
    const first = candidates[0]!;
    out.set(sym, { date: first.date, amount: first.dividend });
  }

  return out;
}

async function catalystsForSymbol(
  symbol: string,
  exDivMap: Map<string, { date: string; amount: number | null }>,
): Promise<ScannerCatalystsWire> {
  const sym = symbol.trim().toUpperCase();

  const [earn, bundle] = await Promise.all([getNextEarningsDate(sym), fetchEarningsHistoryAndForward(sym)]);

  const next_earnings_date = earn.earningsDate;
  const earnings_timing_hint = earningsTimingHintFromTimeString(earn.time);
  const days_to_earnings = earn.daysAway;

  const ex = exDivMap.get(sym);
  let next_ex_dividend_date: string | null = null;
  let ex_dividend_amount: number | null = null;
  let days_to_ex_dividend: number | null = null;
  if (ex) {
    next_ex_dividend_date = ex.date;
    ex_dividend_amount = ex.amount;
    days_to_ex_dividend = daysFromTodayTo(ex.date);
  }

  const hist = bundle.earnings_history;
  const recentNewestFirst = hist.slice(0, 4);
  const oldestToNewest = [...recentNewestFirst].reverse();
  const pcts = oldestToNewest.map((r) => r.price_reaction.close_to_close_pct);

  let reactions_last_4q: number[] | null = null;
  if (pcts.length === 4 && pcts.every((p) => p != null && Number.isFinite(p))) {
    reactions_last_4q = pcts as number[];
  }

  return {
    next_earnings_date,
    earnings_timing_hint,
    days_to_earnings,
    next_ex_dividend_date,
    ex_dividend_amount,
    days_to_ex_dividend,
    reactions_last_4q,
  };
}

/**
 * Layer 4 catalysts for a universe list: one ex-div calendar fetch, then parallel per-symbol
 * earnings + Polygon earnings history (cached internally).
 */
export async function fetchScannerCatalystsForSymbols(symbols: string[]): Promise<Map<string, ScannerCatalystsWire>> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const out = new Map<string, ScannerCatalystsWire>();
  if (uniq.length === 0) return out;

  const exDivMap = await buildNextExDivMap(uniq);
  const limit = pLimit(CATALYST_FETCH_CONCURRENCY);

  await Promise.all(
    uniq.map((sym) =>
      limit(async () => {
        try {
          const row = await catalystsForSymbol(sym, exDivMap);
          out.set(sym, row);
        } catch {
          out.set(sym, { ...EMPTY_WIRE });
        }
      }),
    ),
  );

  return out;
}
