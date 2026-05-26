import {
  CATALYST_DRIFT_SESSION_COUNT,
  CATALYSTS_WINDOW_CALENDAR_DAYS,
  emptyCatalystsFeed,
  type CatalystCard,
  type CatalystsFeed,
  type EarningsTiming,
} from "@workspace/catalysts-types";
import { fetchFmpCompanyProfiles } from "../movers/fmpCompanyProfile.js";
import type { TradeabilityCandidate } from "../movers/tradeabilityGate.js";
import {
  applyCatalystCheapGates,
  applyCatalystOptionsGate,
} from "./applyCatalystCheapGates.js";
import { resolveLiveOptionsChainVerdicts } from "./catalystOptionsChainLive.js";
import { computeSessionSnapshot } from "./catalystMetrics.js";
import { discoverCatalystEarningsInWindow } from "./catalystEarningsDiscovery.js";
import { loadEarningsTimingHints } from "./catalystEarningsTiming.js";
import { reportAtIso } from "./catalystEarningsUtils.js";
import { fetchImpliedMovePct } from "./catalystsImpliedMove.js";
import {
  fetchSchwabDailyClosesBatch,
  fetchSchwabDailyClosesByNyDate,
  latestCloseFromMap,
} from "./schwabDailyCloses.js";
import { lastSettledSessionYmd, settledSessionYmdsEndingAt } from "./settledSessions.js";
import { logger } from "../logger.js";
import { isSpComposite1500Member } from "./sp1500Membership.js";

export async function buildCatalystsFeed(now = new Date()): Promise<CatalystsFeed> {
  const calendar = await discoverCatalystEarningsInWindow(now);

  if (calendar.length === 0) {
    logger.info("Catalysts rebuild: no fresh harvested earnings in window");
    return { ...emptyCatalystsFeed(), status: "ready", builtAt: now.toISOString() };
  }

  const symbols = calendar.map((e) => e.symbol);
  const profiles = await fetchFmpCompanyProfiles(symbols);
  const closesBySymbol = await fetchSchwabDailyClosesBatch(symbols);

  const candidates: TradeabilityCandidate[] = calendar.map((e) => {
    const sym = e.symbol.toUpperCase();
    const px = latestCloseFromMap(closesBySymbol.get(sym) ?? new Map());
    const profile = profiles.get(sym);
    return {
      symbol: sym,
      name: profile?.sector ? sym : sym,
      price: px ?? (profile?.marketCap != null ? 10 : 5),
      changePct: 0,
    };
  });

  for (const c of candidates) {
    const profile = profiles.get(c.symbol);
    if (c.price < 5 && profile?.marketCap != null) c.price = 10;
  }

  const { survivors, filtered: cheapFiltered } = applyCatalystCheapGates(candidates, profiles);
  const optionsVerdicts = await resolveLiveOptionsChainVerdicts(
    survivors.map((c) => c.symbol),
  );
  const {
    tradeable,
    filtered: optionsFiltered,
    optionsStatusBySymbol,
  } = applyCatalystOptionsGate(survivors, optionsVerdicts);
  const filtered = [...cheapFiltered, ...optionsFiltered];

  const endSettled = lastSettledSessionYmd(now);
  const sessionDates = settledSessionYmdsEndingAt(endSettled, CATALYST_DRIFT_SESSION_COUNT);
  const timingHints = await loadEarningsTimingHints(calendar.map((e) => e.symbol));

  const spyCloses = await fetchSchwabDailyClosesByNyDate("SPY");
  const spySnapshot =
    sessionDates.length === CATALYST_DRIFT_SESSION_COUNT
      ? computeSessionSnapshot(sessionDates, spyCloses, spyCloses)
      : null;
  const benchmarkDrift10dPct = spySnapshot?.cumulative10d ?? null;
  const spyHistoryOk = spySnapshot != null;
  if (!spyHistoryOk) {
    logger.warn(
      { sessionDates, spyBars: spyCloses.size },
      "Catalysts rebuild: SPY Schwab history missing — vs S&P will show raw only",
    );
  }

  const tradeableBySymbol = new Map(tradeable.map((t) => [t.symbol, t]));
  const cards: CatalystCard[] = [];
  let droppedNoSessionData = 0;

  for (const e of calendar) {
    const sym = e.symbol.toUpperCase();
    if (!tradeableBySymbol.has(sym)) continue;

    const stockCloses = closesBySymbol.get(sym) ?? new Map();
    const snapshot = computeSessionSnapshot(sessionDates, stockCloses, spyCloses);
    if (!snapshot) {
      droppedNoSessionData += 1;
      continue;
    }

    const profile = profiles.get(sym);
    const timing: EarningsTiming = timingHints.get(sym) ?? null;
    const lastPrice = latestCloseFromMap(stockCloses) ?? tradeableBySymbol.get(sym)?.price ?? null;
    const impliedMovePct = await fetchImpliedMovePct(sym, e.earningsDate, lastPrice);

    cards.push({
      symbol: sym,
      name: sym,
      sector: profile?.sector ?? null,
      industry: profile?.industry ?? null,
      earningsDate: e.earningsDate,
      earningsTiming: timing,
      earningsConfirmed: e.earningsConfirmed,
      reportAtIso: reportAtIso(e.earningsDate, timing),
      lastPrice,
      impliedMovePct,
      inSp1500: isSpComposite1500Member(sym),
      optionsChainUnconfirmed: optionsStatusBySymbol.get(sym) === "unknown",
      snapshot,
    });
  }

  if (droppedNoSessionData > 0) {
    logger.info({ droppedNoSessionData }, "Catalysts rebuild: symbols missing 10-day Schwab history");
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
    benchmarkDrift10dPct: spyHistoryOk ? benchmarkDrift10dPct : null,
    cards,
  };
}
