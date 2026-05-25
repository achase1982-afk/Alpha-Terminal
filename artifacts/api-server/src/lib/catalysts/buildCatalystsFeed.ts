import { and, desc, eq, inArray } from "drizzle-orm";
import {
  CATALYSTS_WINDOW_CALENDAR_DAYS,
  emptyCatalystsFeed,
  type CatalystCard,
  type CatalystsFeed,
  type EarningsTiming,
} from "@workspace/catalysts-types";
import { db, equityDailyTable } from "@workspace/db";
import { fetchFmpCompanyProfiles } from "../movers/fmpCompanyProfile.js";
import {
  applyTradeabilityGate,
  type TradeabilityCandidate,
} from "../movers/tradeabilityGate.js";
import { computeSessionSnapshot } from "./catalystMetrics.js";
import { fetchImpliedMovePct } from "./catalystsImpliedMove.js";
import { resolveSymbolsWithOptions } from "./optionsExistence.js";
import { lastSettledSessionYmd, settledSessionYmdsEndingAt } from "./settledSessions.js";
import {
  fetchVendorEarningsCalendar,
  filterEarningsInWindow,
  reportAtIso,
  type VendorEarningsRow,
} from "./vendorEarningsCalendar.js";
import { logger } from "../logger.js";

async function loadClosesForSessions(
  symbol: string,
  sessionDates: string[],
): Promise<Map<string, number>> {
  const sym = symbol.toUpperCase();
  const needDates = new Set(sessionDates);
  const earliest = sessionDates[0];
  if (!earliest) return new Map();

  const rows = await db
    .select({ date: equityDailyTable.date, close: equityDailyTable.close })
    .from(equityDailyTable)
    .where(and(eq(equityDailyTable.symbol, sym), inArray(equityDailyTable.date, [...needDates])))
    .orderBy(desc(equityDailyTable.date));

  const map = new Map<string, number>();
  for (const r of rows) {
    const d = String(r.date);
    map.set(d, r.close);
  }

  if (map.size < sessionDates.length) {
    const priorRows = await db
      .select({ date: equityDailyTable.date, close: equityDailyTable.close })
      .from(equityDailyTable)
      .where(eq(equityDailyTable.symbol, sym))
      .orderBy(desc(equityDailyTable.date))
      .limit(12);

    for (const r of priorRows) {
      const d = String(r.date);
      if (!map.has(d)) map.set(d, r.close);
    }
  }

  return map;
}

function dedupeEarningsRows(rows: VendorEarningsRow[]): VendorEarningsRow[] {
  const byTicker = new Map<string, VendorEarningsRow>();
  for (const r of rows) {
    const sym = r.ticker.toUpperCase();
    const existing = byTicker.get(sym);
    if (!existing || r.date < existing.date) {
      byTicker.set(sym, r);
    }
  }
  return [...byTicker.values()];
}

export async function buildCatalystsFeed(now = new Date()): Promise<CatalystsFeed> {
  const allEarnings = await fetchVendorEarningsCalendar(logger);
  const inWindow = filterEarningsInWindow(allEarnings, CATALYSTS_WINDOW_CALENDAR_DAYS, now);
  const calendar = dedupeEarningsRows(inWindow);

  if (calendar.length === 0) {
    return { ...emptyCatalystsFeed(), status: "ready", builtAt: now.toISOString() };
  }

  const candidates: TradeabilityCandidate[] = calendar.map((e) => ({
    symbol: e.ticker.toUpperCase(),
    name: e.name,
    price: 10,
    changePct: 0,
  }));

  const profiles = await fetchFmpCompanyProfiles(candidates.map((c) => c.symbol));

  for (const c of candidates) {
    const profile = profiles.get(c.symbol);
    const rows = await db
      .select({ close: equityDailyTable.close })
      .from(equityDailyTable)
      .where(eq(equityDailyTable.symbol, c.symbol))
      .orderBy(desc(equityDailyTable.date))
      .limit(1);
    const px = rows[0]?.close;
    if (px != null && Number.isFinite(px)) c.price = px;
    else if (profile?.marketCap != null) c.price = Math.max(5, c.price);
  }

  const symbolsWithOptions = await resolveSymbolsWithOptions(candidates.map((c) => c.symbol));
  const { tradeable, filtered } = applyTradeabilityGate(candidates, profiles, {
    requireOptionsChain: true,
    symbolsWithOptions,
  });

  const tradeableBySymbol = new Map(tradeable.map((t) => [t.symbol, t]));
  const endSettled = lastSettledSessionYmd(now);
  const sessionDates = settledSessionYmdsEndingAt(endSettled, 5);

  const cards: CatalystCard[] = [];

  for (const e of calendar) {
    const sym = e.ticker.toUpperCase();
    if (!tradeableBySymbol.has(sym)) continue;

    const closesByDate = await loadClosesForSessions(sym, sessionDates);
    const snapshot = computeSessionSnapshot(sessionDates, closesByDate);
    if (!snapshot) continue;

    const profile = profiles.get(sym);
    const timing: EarningsTiming =
      e.time === "BMO" || e.time === "AMC" ? e.time : null;
    const lastPrice = tradeableBySymbol.get(sym)?.price ?? null;
    const impliedMovePct = await fetchImpliedMovePct(sym, e.date, lastPrice);

    cards.push({
      symbol: sym,
      name: e.name,
      sector: profile?.sector ?? null,
      industry: profile?.industry ?? null,
      earningsDate: e.date,
      earningsTiming: timing,
      earningsConfirmed: e.confirmed,
      reportAtIso: reportAtIso(e.date, timing),
      lastPrice,
      impliedMovePct,
      snapshot,
    });
  }

  cards.sort((a, b) => a.earningsDate.localeCompare(b.earningsDate) || a.symbol.localeCompare(b.symbol));

  return {
    builtAt: now.toISOString(),
    status: "ready",
    windowDays: CATALYSTS_WINDOW_CALENDAR_DAYS,
    funnel: {
      calendar: calendar.length,
      filtered: filtered.length,
      tradeable: cards.length,
    },
    cards,
  };
}
