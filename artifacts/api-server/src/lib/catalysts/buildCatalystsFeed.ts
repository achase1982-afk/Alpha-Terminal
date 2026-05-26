import {
  CATALYST_DRIFT_SESSION_COUNT,
  CATALYSTS_WINDOW_CALENDAR_DAYS,
  emptyCatalystFilterBreakdown,
  emptyCatalystsFeed,
  normalizeCatalystGateSettings,
  type CatalystCard,
  type CatalystFilterBreakdown,
  type CatalystGateSettings,
  type CatalystsFeed,
  type EarningsTiming,
} from "@workspace/catalysts-types";
import type { FilteredName } from "@workspace/movers-types";
import { fetchFmpCompanyProfiles } from "../movers/fmpCompanyProfile.js";
import type { TradeabilityCandidate } from "../movers/tradeabilityGate.js";
import { applyCatalystGates } from "./applyCatalystGates.js";
import { applyCatalystOptionsGate } from "./applyCatalystCheapGates.js";
import type { CatalystOptionsChainVerdict } from "./catalystOptionsChainLive.js";
import { getCatalystGateSettings } from "./catalystGateSettingsStore.js";
import { resolveLiveOptionsChainVerdicts } from "./catalystOptionsChainLive.js";
import { computeSessionSnapshot, emptySessionSnapshot } from "./catalystMetrics.js";
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

function tallyFilterBreakdown(
  filtered: FilteredName[],
  noSessionData: number,
): CatalystFilterBreakdown {
  const breakdown = emptyCatalystFilterBreakdown();
  for (const row of filtered) {
    const reason = row.reason;
    if (reason === "LEVERAGED_ETF") breakdown.LEVERAGED_ETF += 1;
    else if (reason === "SUB_5") breakdown.SUB_5 += 1;
    else if (reason === "MICRO_CAP") breakdown.MICRO_CAP += 1;
    else if (reason === "LOW_VOLUME") breakdown.LOW_VOLUME += 1;
    else if (reason === "NO_OPTIONS") breakdown.NO_OPTIONS += 1;
  }
  breakdown.NO_SESSION_DATA = noSessionData;
  return breakdown;
}

export async function buildCatalystsFeed(
  now = new Date(),
  gateSettingsOverride?: Partial<CatalystGateSettings>,
): Promise<CatalystsFeed> {
  const gateSettings = normalizeCatalystGateSettings({
    ...getCatalystGateSettings(),
    ...gateSettingsOverride,
  });

  const calendar = await discoverCatalystEarningsInWindow(now);

  if (calendar.length === 0) {
    logger.info("Catalysts rebuild: no fresh harvested earnings in window");
    return {
      ...emptyCatalystsFeed(),
      status: "ready",
      builtAt: now.toISOString(),
      gateSettings,
    };
  }

  const symbols = calendar.map((e) => e.symbol);
  const profiles = await fetchFmpCompanyProfiles(symbols);

  const needsPriceForGates =
    gateSettings.gatesEnabled &&
    gateSettings.requirePriceFloor &&
    gateSettings.priceFloorUsd > 0;
  const preGateCloses = needsPriceForGates
    ? await fetchSchwabDailyClosesBatch(symbols)
    : new Map<string, Map<string, number>>();

  const candidates: TradeabilityCandidate[] = calendar.map((e) => {
    const sym = e.symbol.toUpperCase();
    const profile = profiles.get(sym);
    const px = latestCloseFromMap(preGateCloses.get(sym) ?? new Map());
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

  const cheapGateSettings = { ...gateSettings, requireOptionsChain: false };
  const { tradeable: survivors, filtered: cheapFiltered } = applyCatalystGates(
    candidates,
    profiles,
    cheapGateSettings,
    new Set(candidates.map((c) => c.symbol.toUpperCase())),
  );

  let tradeable: TradeabilityCandidate[];
  let optionsFiltered: FilteredName[] = [];
  let optionsStatusBySymbol = new Map<string, CatalystOptionsChainVerdict>();

  if (gateSettings.requireOptionsChain) {
    const optionsVerdicts = await resolveLiveOptionsChainVerdicts(
      survivors.map((c) => c.symbol),
    );
    ({
      tradeable,
      filtered: optionsFiltered,
      optionsStatusBySymbol,
    } = applyCatalystOptionsGate(survivors, optionsVerdicts));
  } else {
    tradeable = survivors;
  }

  const filtered = [...cheapFiltered, ...optionsFiltered];

  const endSettled = lastSettledSessionYmd(now);
  const sessionDates = settledSessionYmdsEndingAt(endSettled, CATALYST_DRIFT_SESSION_COUNT);
  const timingHints = await loadEarningsTimingHints(calendar.map((e) => e.symbol));

  const driftSymbols = [...new Set(tradeable.map((t) => t.symbol.toUpperCase()))];
  const closesBySymbol = await fetchSchwabDailyClosesBatch(driftSymbols);

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
    let snapshot = computeSessionSnapshot(sessionDates, stockCloses, spyCloses);
    if (!snapshot) {
      if (gateSettings.requireSessionSnapshot) {
        droppedNoSessionData += 1;
        continue;
      }
      snapshot = emptySessionSnapshot();
      snapshot.patternRead =
        stockCloses.size === 0
          ? "Session drift unavailable — no price history from Schwab or FMP for this symbol."
          : "Session drift unavailable — fewer than 10 settled sessions in price history.";
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
      filterBreakdown: tallyFilterBreakdown(filtered, droppedNoSessionData),
    },
    benchmarkDrift10dPct: spyHistoryOk ? benchmarkDrift10dPct : null,
    gateSettings,
    cards,
  };
}
