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
import { discoverCatalystEarningsInWindow } from "./catalystEarningsDiscovery.js";
import { loadEarningsTimingHints } from "./catalystEarningsTiming.js";
import { reportAtIso } from "./catalystEarningsUtils.js";
import { fetchImpliedMovePct } from "./catalystsImpliedMove.js";
import { resolveSymbolsWithOptions } from "./optionsExistence.js";
import { lastSettledSessionYmd, settledSessionYmdsEndingAt } from "./settledSessions.js";
import { logger } from "../logger.js";
import { isSpComposite1500Member } from "./sp1500Membership.js";

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

export async function buildCatalystsFeed(now = new Date()): Promise<CatalystsFeed> {
  const calendar = await discoverCatalystEarningsInWindow(now);

  if (calendar.length === 0) {
    logger.info("Catalysts rebuild: no fresh harvested earnings in window");
    return { ...emptyCatalystsFeed(), status: "ready", builtAt: now.toISOString() };
  }

  const candidates: TradeabilityCandidate[] = calendar.map((e) => ({
    symbol: e.symbol,
    name: e.symbol,
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

  const timingHints = await loadEarningsTimingHints(calendar.map((e) => e.symbol));

  const spyCloses = await loadClosesForSessions("SPY", sessionDates);
  const spySnapshot = computeSessionSnapshot(sessionDates, spyCloses);
  const benchmarkDrift5dPct = spySnapshot?.cumulative5d ?? null;

  const cards: CatalystCard[] = [];

  for (const e of calendar) {
    const sym = e.symbol;
    if (!tradeableBySymbol.has(sym)) continue;

    const closesByDate = await loadClosesForSessions(sym, sessionDates);
    const snapshot = computeSessionSnapshot(sessionDates, closesByDate);
    if (!snapshot) continue;

    const profile = profiles.get(sym);
    const timing: EarningsTiming = timingHints.get(sym) ?? null;
    const lastPrice = tradeableBySymbol.get(sym)?.price ?? null;
    const impliedMovePct = await fetchImpliedMovePct(sym, e.earningsDate, lastPrice);

    const tradeableRow = tradeableBySymbol.get(sym);
    cards.push({
      symbol: sym,
      name: tradeableRow?.name ?? sym,
      sector: profile?.sector ?? null,
      industry: profile?.industry ?? null,
      earningsDate: e.earningsDate,
      earningsTiming: timing,
      earningsConfirmed: e.earningsConfirmed,
      reportAtIso: reportAtIso(e.earningsDate, timing),
      lastPrice,
      impliedMovePct,
      inSp1500: isSpComposite1500Member(sym),
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
    benchmarkDrift5dPct,
    cards,
  };
}
