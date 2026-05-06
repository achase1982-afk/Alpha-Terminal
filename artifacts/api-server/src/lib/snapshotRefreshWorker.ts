/**
 * Background refresh of ticker_signal_snapshot for LC130 (30s cadence in session window).
 */
import pLimit from "p-limit";
import { and, desc, eq, gte } from "drizzle-orm";
import {
  corporateEventsTable,
  db,
  equityDailyTable,
  scannerHealthTable,
  scannerTapeMetricsTable,
  scannerTickerCycleCoverageTable,
  tickerSignalSnapshotTable,
} from "@workspace/db";
import { LIQUID_CORE_SYMBOL_STRINGS } from "../data/liquidCore130.js";
import { fetchPolygonChain, type PolygonParsedContract } from "./polygonChain.js";
import { getNextEarningsDate } from "./earningsService.js";
import { getPolygonFlowHighlights } from "./polygonFlowHighlights.js";
import { evaluateRegimeShock } from "./regimeShockDetector.js";
import { getLiveMarketIndicatorsForPulse } from "./liveMarketIndicators.js";
import { impliedVolToVolPoints, classifyEdgeType, type ScannerEdgeType } from "./scannerEdgeType.js";
import { getScannerSector } from "./scannerSectorMap.js";
import { polygonKey } from "./polygonAnalystData.js";
import { fetchEarningsHistoryAndForward } from "./polygonEarningsHistory.js";
import { logger } from "./logger.js";
import {
  buildEarningsEdgeSignature,
  getIvRvAtmPoints,
  liquidityAnchorFromFrontExpiry,
  macroDensityInWindow,
  scannerCompositeV1,
  scoreCatalystTermShape,
  scoreFlowQualityV1,
  scoreImpliedMoveRichness,
  scoreIvVsRealizedMulti,
  scoreSkewAnomaly,
  surfacedSubScoresHigh,
  type ScannerComponentScoresV1,
  type TermSlicePoint,
} from "./scannerScoringV2.js";
import type { ChainContract } from "./strategistV2.js";
import { summarizeOptionsChain, type ChainSummary } from "./strategistV2.js";
import { getSettings } from "./strategistSettings.js";
import {
  classifyTapeCoverageTier,
  type TapeCoverageTier,
} from "./scannerTapeCoverage.js";

const log = logger.child({ module: "snapshotRefreshWorker" });

const REFRESH_INTERVAL_MS = 30_000;
const CONCURRENCY = 10;
const LC130 = [...LIQUID_CORE_SYMBOL_STRINGS];

type MarketCapTier = "mega" | "large" | "mid" | "small";

function tierFromMarketCapUsd(mc: number | null | undefined): MarketCapTier {
  if (mc == null || !Number.isFinite(mc) || mc <= 0) return "mid";
  if (mc >= 200e9) return "mega";
  if (mc >= 10e9) return "large";
  if (mc >= 2e9) return "mid";
  return "small";
}

function nyYmd(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/** 9:00–16:30 ET: regular hours plus 30m extended pre/post. */
function isSnapshotWorkerWindowEt(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
    weekday: "short",
  }).formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  if (wd === "Sat" || wd === "Sun") return false;
  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const mins = h * 60 + m;
  return mins >= 9 * 60 && mins < 16 * 60 + 30;
}

function mid(b?: number, a?: number): number | null {
  if (b != null && a != null && b > 0 && a > 0) return (b + a) / 2;
  if (b != null && b > 0) return b;
  if (a != null && a > 0) return a;
  return null;
}

function interpolateIvAtSpot(contracts: PolygonParsedContract[], spot: number): number | null {
  if (!Number.isFinite(spot) || spot <= 0 || contracts.length === 0) return null;
  const rows = contracts
    .filter((c) => c.strike > 0)
    .map((c) => ({
      strike: c.strike,
      iv: impliedVolToVolPoints(c.iv ?? null),
    }))
    .filter((c): c is { strike: number; iv: number } => c.iv != null);
  if (rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => a.strike - b.strike);
  let below: { strike: number; iv: number } | null = null;
  let above: { strike: number; iv: number } | null = null;
  for (const r of sorted) {
    if (r.strike <= spot) below = r;
    if (r.strike >= spot) {
      above = r;
      break;
    }
  }
  if (below && above && below.strike !== above.strike) {
    const t = (spot - below.strike) / (above.strike - below.strike);
    return below.iv + (above.iv - below.iv) * t;
  }
  let best = sorted[0];
  let bestD = Math.abs(sorted[0].strike - spot);
  for (const r of sorted) {
    const d = Math.abs(r.strike - spot);
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best.iv;
}

function closestDeltaIv(
  contracts: PolygonParsedContract[],
  targetDelta: number,
): { iv: number; delta: number; strike: number } | null {
  let best: { iv: number; delta: number; strike: number } | null = null;
  let bestD = Infinity;
  for (const c of contracts) {
    const d = c.delta;
    const ivp = impliedVolToVolPoints(c.iv ?? null);
    if (d == null || ivp == null) continue;
    const diff = Math.abs(d - targetDelta);
    if (diff < bestD) {
      bestD = diff;
      best = { iv: ivp, delta: d, strike: c.strike };
    }
  }
  return best;
}

function pickFrontNextExpiries(calls: PolygonParsedContract[], puts: PolygonParsedContract[]): {
  front: string | null;
  next: string | null;
} {
  const exps = new Set<string>();
  for (const c of calls) if (c.expiration) exps.add(c.expiration);
  for (const p of puts) if (p.expiration) exps.add(p.expiration);
  const sorted = [...exps].sort();
  if (sorted.length === 0) return { front: null, next: null };
  const today = nyYmd(new Date());
  const future = sorted.filter((e) => e >= today);
  const use = future.length ? future : sorted;
  return { front: use[0] ?? null, next: use[1] ?? null };
}

function contractsForExpiry(
  calls: PolygonParsedContract[],
  puts: PolygonParsedContract[],
  exp: string,
): { calls: PolygonParsedContract[]; puts: PolygonParsedContract[] } {
  return {
    calls: calls.filter((c) => c.expiration === exp),
    puts: puts.filter((p) => p.expiration === exp),
  };
}

/** Polygon snapshot rows → strategist ChainContract (IV decimal σ). */
function polygonToChainContracts(chain: NonNullable<Awaited<ReturnType<typeof fetchPolygonChain>>>): ChainContract[] {
  const out: ChainContract[] = [];
  const push = (c: PolygonParsedContract, side: "call" | "put") => {
    const bid = c.bid ?? 0;
    const ask = c.ask ?? 0;
    const ivDec =
      c.iv != null && Number.isFinite(c.iv) && c.iv > 0 ? (c.iv > 1 ? c.iv / 100 : c.iv) : null;
    out.push({
      strike: c.strike,
      expiration: c.expiration,
      type: side,
      optionType: side === "call" ? "CALL" : "PUT",
      bid,
      ask,
      mid: (bid + ask) / 2,
      delta: c.delta ?? 0,
      openInterest: c.openInterest ?? 0,
      volume: c.volume ?? 0,
      impliedVolatility: ivDec,
      dte: c.dte ?? 0,
    });
  };
  for (const c of chain.calls) push(c, "call");
  for (const p of chain.puts) push(p, "put");
  return out;
}

function deskWindowIsoFromAvailableExpiries(availableExpirations: string[], prefsMax: number): string | null {
  let best: string | null = null;
  let bestDte = -1;
  for (const exp of availableExpirations) {
    const expMs = new Date(`${exp}T16:00:00-05:00`).getTime();
    const dte = Math.max(0, Math.round((expMs - Date.now()) / (24 * 60 * 60 * 1000)));
    if (dte <= 0 || dte > prefsMax) continue;
    if (dte > bestDte) {
      bestDte = dte;
      best = exp;
    }
  }
  return best;
}

function deskWindowSyntheticIso(prefsMax: number): string {
  const t = Date.now() + prefsMax * 86_400_000;
  const u = new Date(t);
  const y = u.getUTCFullYear();
  const m = String(u.getUTCMonth() + 1).padStart(2, "0");
  const d = String(u.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function computeDeskCatalystExpirationISO(
  availableExpirations: string[],
  curatedExpirations: ChainSummary["curatedExpirations"],
  prefsMax: number,
): string {
  const fromAvail = deskWindowIsoFromAvailableExpiries(availableExpirations, prefsMax);
  if (fromAvail) return fromAvail;
  let best: string | null = null;
  let bestDte = -1;
  for (const ce of curatedExpirations) {
    if (ce.dte <= 0 || ce.dte > prefsMax) continue;
    if (ce.dte > bestDte) {
      bestDte = ce.dte;
      best = ce.expiration;
    }
  }
  if (best) return best;
  return deskWindowSyntheticIso(prefsMax);
}

function flowNotionalThreshold(tier: MarketCapTier): number {
  switch (tier) {
    case "mega":
      return 100_000;
    case "large":
      return 50_000;
    case "mid":
      return 25_000;
    default:
      return 10_000;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function hvToVolPoints(hv: number | null): number | null {
  if (hv == null || !Number.isFinite(hv) || hv <= 0) return null;
  if (hv < 1) return hv * 100;
  return hv;
}

function termStripFromSummary(chainSummary: ChainSummary | null, fallback: TermSlicePoint[]): TermSlicePoint[] {
  if (!chainSummary?.termStructure5pt?.length) return fallback;
  return chainSummary.termStructure5pt.map((p) => ({
    expiry: p.expiry,
    days_to_exp: p.daysToExpiry,
    atm_iv: p.atmIV,
  }));
}

async function refreshTicker(
  ticker: string,
  regimeShockActive: boolean,
): Promise<{
  elapsedMs: number;
  chainContractCount: number;
  tapeMetricRow: typeof scannerTapeMetricsTable.$inferSelect | null;
  tapeCoverageTier: TapeCoverageTier;
}> {
  const tStart = Date.now();
  const upper = ticker.toUpperCase();
  const now = new Date();
  const attemptAt = now;
  const nyToday = nyYmd(now);
  const apiKey = polygonKey();
  const deskSettings = await getSettings();

  const [chain, earn, flowHl, eqRow, earnHist, corpDateRows] = await Promise.all([
    apiKey ? fetchPolygonChain(upper, apiKey, { maxDte: 45, maxPages: 8, log }) : Promise.resolve(null),
    getNextEarningsDate(upper),
    getPolygonFlowHighlights(upper),
    db
      .select()
      .from(equityDailyTable)
      .where(eq(equityDailyTable.symbol, upper))
      .orderBy(desc(equityDailyTable.date))
      .limit(1)
      .then((r) => r[0] ?? null),
    fetchEarningsHistoryAndForward(upper),
    db
      .selectDistinct({ d: corporateEventsTable.earningsDate })
      .from(corporateEventsTable)
      .where(and(eq(corporateEventsTable.symbol, upper), gte(corporateEventsTable.earningsDate, nyToday))),
  ]);

  const spot =
    (chain?.underlyingPrice && chain.underlyingPrice > 0 ? chain.underlyingPrice : null) ??
    (eqRow?.close != null ? Number(eqRow.close) : null);

  const dailyChangePct =
    eqRow?.priceChangePct5d != null && Number.isFinite(Number(eqRow.priceChangePct5d))
      ? Number(eqRow.priceChangePct5d)
      : null;

  const ivr = eqRow?.ivr != null ? Number(eqRow.ivr) : null;
  const ivrSource = eqRow?.ivrSource ?? null;
  const hv20 = eqRow?.hv20d != null ? Number(eqRow.hv20d) : null;
  const hv30 = eqRow?.hv30d != null ? Number(eqRow.hv30d) : null;
  const mcUsd = eqRow?.marketCap != null ? Number(eqRow.marketCap) : null;
  const tier = tierFromMarketCapUsd(mcUsd);
  const sector = getScannerSector(upper);
  const halted = !!(eqRow?.haltStatus ?? false);

  let chainSummary: ChainSummary | null = null;
  let chainContractCount = 0;
  if (chain && spot && spot > 0) {
    const contracts = polygonToChainContracts(chain);
    chainContractCount = contracts.length;
    try {
      chainSummary = await summarizeOptionsChain(contracts, spot, {
        ticker: upper,
        earningsDate: earn.earningsDate,
        settings: deskSettings,
      });
    } catch (e) {
      log.warn({ err: e, ticker: upper }, "summarizeOptionsChain failed; falling back to raw polygon strip");
    }
  }

  let atmIvByExpiry: TermSlicePoint[] = [];
  let skew25dByExpiry: Array<{ expiry: string; put_iv_25d: number; call_iv_25d: number; skew_pts: number }> = [];
  let impliedMoveFrontPct: number | null = null;
  let impliedMoveFrontAbs: number | null = null;
  let atmOiFront: number | null = null;
  let bidAskWidthAtmFront: number | null = null;
  let frontWeekAtmIv: number | null = null;
  let nextWeekAtmIv: number | null = null;
  let skewPtsAligned: number | null = null;
  let chainUpdatedAt: Date | null = null;
  let frontExp: string | null = null;
  let nextExp: string | null = null;

  if (chain && spot && spot > 0) {
    chainUpdatedAt = new Date();
    const pn = pickFrontNextExpiries(chain.calls, chain.puts);
    frontExp = pn.front;
    nextExp = pn.next;

    if (chainSummary?.termStructure5pt?.length) {
      atmIvByExpiry = termStripFromSummary(chainSummary, []);
    } else {
      for (const exp of [frontExp, nextExp].filter(Boolean) as string[]) {
        const { calls: cE, puts: pE } = contractsForExpiry(chain.calls, chain.puts, exp);
        const callIv = interpolateIvAtSpot(cE, spot);
        const expDate = new Date(`${exp}T20:00:00Z`);
        const dte = Math.max(0, Math.round((expDate.getTime() - now.getTime()) / 86_400_000));
        if (callIv != null) atmIvByExpiry.push({ expiry: exp, days_to_exp: dte, atm_iv: callIv });
        const p25 = closestDeltaIv(pE, -0.25);
        const c25 = closestDeltaIv(cE, 0.25);
        if (p25 && c25) {
          skew25dByExpiry.push({
            expiry: exp,
            put_iv_25d: p25.iv,
            call_iv_25d: c25.iv,
            skew_pts: p25.iv - c25.iv,
          });
        }
      }
    }

    if (chainSummary?.skew25Delta != null && chainSummary.skew25DeltaReason === "clean_25d_first_expiry") {
      skewPtsAligned = chainSummary.skew25Delta.skewPoints;
    } else if (frontExp) {
      const { calls: cF, puts: pF } = contractsForExpiry(chain.calls, chain.puts, frontExp);
      const p25f = closestDeltaIv(pF, -0.25);
      const c25f = closestDeltaIv(cF, 0.25);
      if (p25f && c25f) skewPtsAligned = p25f.iv - c25f.iv;
    }

    if (frontExp) {
      const { calls: cF, puts: pF } = contractsForExpiry(chain.calls, chain.puts, frontExp);
      frontWeekAtmIv = interpolateIvAtSpot(cF, spot);
      if (!skew25dByExpiry.length) {
        const p25 = closestDeltaIv(pF, -0.25);
        const c25 = closestDeltaIv(cF, 0.25);
        if (p25 && c25) {
          skew25dByExpiry.push({
            expiry: frontExp,
            put_iv_25d: p25.iv,
            call_iv_25d: c25.iv,
            skew_pts: p25.iv - c25.iv,
          });
        }
      }

      let belowC: PolygonParsedContract | null = null;
      let aboveC: PolygonParsedContract | null = null;
      for (const c of [...cF].sort((a, b) => a.strike - b.strike)) {
        if (c.strike <= spot) belowC = c;
        if (c.strike >= spot && !aboveC) aboveC = c;
      }
      let belowP: PolygonParsedContract | null = null;
      let aboveP: PolygonParsedContract | null = null;
      for (const p of [...pF].sort((a, b) => a.strike - b.strike)) {
        if (p.strike <= spot) belowP = p;
        if (p.strike >= spot && !aboveP) aboveP = p;
      }

      const interpMid = (below: PolygonParsedContract | null, above: PolygonParsedContract | null): number | null => {
        if (below && above && below.strike !== above.strike) {
          const mb = mid(below.bid, below.ask);
          const ma = mid(above.bid, above.ask);
          if (mb == null || ma == null) return null;
          const t = (spot - below.strike) / (above.strike - below.strike);
          return mb + (ma - mb) * t;
        }
        const one = below ?? above;
        return one ? mid(one.bid, one.ask) : null;
      };

      const callMid = interpMid(belowC, aboveC);
      const putMid = interpMid(belowP, aboveP);
      if (callMid != null && putMid != null && spot > 0) {
        impliedMoveFrontAbs = callMid + putMid;
        impliedMoveFrontPct = (impliedMoveFrontAbs / spot) * 100;
      }

      const atmC =
        belowC && aboveC
          ? Math.abs(belowC.strike - spot) < Math.abs(aboveC.strike - spot)
            ? belowC
            : aboveC
          : belowC ?? aboveC;
      if (atmC) {
        atmOiFront = atmC.openInterest ?? null;
        const m = mid(atmC.bid, atmC.ask);
        const bid = atmC.bid ?? m;
        const ask = atmC.ask ?? m;
        if (m != null && m > 0 && bid != null && ask != null) {
          bidAskWidthAtmFront = (ask - bid) / m;
        }
      }
    }

    if (nextExp) {
      const { calls: cN } = contractsForExpiry(chain.calls, chain.puts, nextExp);
      nextWeekAtmIv = interpolateIvAtSpot(cN, spot);
    }
  }

  const listedExp =
    chain && chain.calls.length
      ? [...new Set([...chain.calls, ...chain.puts].map((c) => c.expiration))].sort()
      : [];
  const strip = termStripFromSummary(chainSummary, atmIvByExpiry);
  const earningsDateStr = earn.earningsDate;
  const earningsDaysAway = earn.daysAway;
  const earningsConfirmed = earn.confirmed;

  const distinctFutureEarnDates = new Set(
    corpDateRows.map((r) => (r.d != null ? String(r.d).slice(0, 10) : "")).filter(Boolean),
  );
  const earningsDateConflict =
    earningsDateStr != null
    && distinctFutureEarnDates.size > 1
    && distinctFutureEarnDates.has(earningsDateStr);

  const ivPack = chainSummary
    ? getIvRvAtmPoints({
        strip,
        earningsYmd: earningsDateStr,
        listedExpirationsSorted: listedExp,
      })
    : { front: frontWeekAtmIv, preEvent: null, event: null };

  const termShape = scoreCatalystTermShape({
    strip,
    earningsYmd: earningsDateStr,
    listedExpirationsSorted: listedExp,
  });
  const ivRv = scoreIvVsRealizedMulti({
    atmIvFront: ivPack.front,
    atmIvPreEvent: ivPack.preEvent,
    atmIvEvent: ivPack.event,
    hv20,
    hv30,
  });
  const skewS = scoreSkewAnomaly(skewPtsAligned);

  const prefsMax = Math.max(1, deskSettings.preferredDteMax | 0);
  const deskEndIso = chainSummary
    ? computeDeskCatalystExpirationISO(chainSummary.availableExpirations, chainSummary.curatedExpirations, prefsMax)
    : null;
  const macroWin = macroDensityInWindow({ now, windowEndYmd: deskEndIso });

  const earningsEdge = buildEarningsEdgeSignature(earnHist);
  const histQuarters = [...earnHist.earnings_history].filter((r) => r.price_reaction.gap_open_pct != null).slice(0, 12);
  const moveRich = scoreImpliedMoveRichness({
    currentImpliedMovePct: impliedMoveFrontPct,
    historicalRows: histQuarters,
  });

  let liqScore = 0;
  let liqMaxOi = 0;
  let liqDeepStrike: number | null = null;
  if (chain && frontExp && spot && spot > 0) {
    const { calls: cFf, puts: pFf } = contractsForExpiry(chain.calls, chain.puts, frontExp);
    const liq = liquidityAnchorFromFrontExpiry({ calls: cFf, puts: pFf, spot });
    liqScore = liq.score;
    liqMaxOi = liq.maxOi;
    liqDeepStrike = liq.deepestStrike;
  }

  const tape = flowHl?.sessionTape;
  const totals = tape?.aggressorSessionTotals;
  const isLiveAggUsd =
    tape?.tapeKind === "live" && tape.sessionAggregateSource === "live_raw_trades" && totals != null;
  let askNotional = 0;
  let bidNotional = 0;
  let midNotional = 0;
  if (isLiveAggUsd && totals) {
    askNotional = totals.askNotionalUsd;
    bidNotional = totals.bidNotionalUsd;
    midNotional = totals.midNotionalUsd;
  }

  const tapeSessionYmd =
    tape?.sessionDate && /^\d{4}-\d{2}-\d{2}$/.test(String(tape.sessionDate))
      ? String(tape.sessionDate).slice(0, 10)
      : null;

  let tapeMetricRow: typeof scannerTapeMetricsTable.$inferSelect | null = null;
  const tmRows = await db
    .select()
    .from(scannerTapeMetricsTable)
    .where(eq(scannerTapeMetricsTable.ticker, upper))
    .orderBy(desc(scannerTapeMetricsTable.updatedAt))
    .limit(5);
  if (tapeSessionYmd) {
    tapeMetricRow = tmRows.find((r) => String(r.sessionDate).slice(0, 10) === tapeSessionYmd) ?? null;
  }
  if (!tapeMetricRow && tmRows.length > 0) {
    tapeMetricRow = tmRows[0] ?? null;
  }

  let tapeCoverageTier: TapeCoverageTier = "not_run";
  if (tapeMetricRow) {
    tapeCoverageTier = classifyTapeCoverageTier({
      occRequested: tapeMetricRow.occRequested,
      occCompleted: tapeMetricRow.occCompleted,
      tradesAttemptedInsert: tapeMetricRow.tradesAttemptedInsert,
      tradesInsertedCommitted: tapeMetricRow.tradesInsertedCommitted,
      dedupeDropped: tapeMetricRow.dedupeDropped,
      anyTruncated: tapeMetricRow.anyTruncated,
      pipelineStatus: tapeMetricRow.status,
    });
  } else if (tape?.tapeKind === "live" && tape.sessionAggregateSource === "live_raw_trades") {
    tapeCoverageTier = "high";
  }

  const tapeKindForScore: "live" | "eod_fallback" | "none" =
    tape?.tapeKind === "live" ? "live" : tape?.tapeKind === "eod_fallback" ? "eod_fallback" : "none";
  const sessSrcForScore: "live_raw_trades" | "eod_volume_only" | "none" =
    tape?.sessionAggregateSource === "live_raw_trades"
      ? "live_raw_trades"
      : tape?.sessionAggregateSource === "eod_volume_only"
        ? "eod_volume_only"
        : "none";

  const topStrikeRow = flowHl?.topByVolume?.[0];
  const totalN = askNotional + bidNotional + midNotional;
  const askPct = totalN > 0 ? (askNotional / totalN) * 100 : 0;

  const flowSc = scoreFlowQualityV1({
    tapeKind: tapeKindForScore,
    sessionAggregateSource: sessSrcForScore,
    askNotionalUsd: askNotional,
    tierThresholdUsd: flowNotionalThreshold(tier),
    totals:
      totals != null
        ? {
            askCount: totals.askCount,
            bidCount: totals.bidCount,
            midCount: totals.midCount,
            unknownCount: totals.unknownCount,
            totalPrints: totals.totalPrints,
            askNotionalUsd: totals.askNotionalUsd,
            bidNotionalUsd: totals.bidNotionalUsd,
            midNotionalUsd: totals.midNotionalUsd,
            unknownNotionalUsd: totals.unknownNotionalUsd,
          }
        : null,
    topPrints: tape?.topPrints ?? null,
    tapeCoverageTier,
  });

  const ivCleanedRatio = chainSummary?.ivChainFilter.ivCleanedRatio ?? 1;
  const ivContamShare =
    chainSummary && chainSummary.ivChainFilter.totalChainContracts > 0
      ? chainSummary.ivChainFilter.ivContaminationCountedClamps / chainSummary.ivChainFilter.totalChainContracts
      : 0;
  const ivContaminationElevated = ivContamShare > 0.3;

  const captureRow = chainSummary?.curatedExpirations?.find((e) => e.bucket === "earnings_capture");
  const captureExpiryIso = captureRow?.expiration ?? null;
  const captureAtm =
    captureExpiryIso != null
      ? chainSummary?.termStructure5pt.find((p) => p.expiry === captureExpiryIso)?.atmIV ?? null
      : null;
  const noCleanEarningsExpiry =
    earningsDateStr != null && captureExpiryIso != null && captureAtm == null;

  const flowSummary = {
    ask_notional: askNotional,
    bid_notional: bidNotional,
    mid_notional: midNotional,
    ask_pct: askPct,
    top_strike: topStrikeRow
      ? { strike: topStrikeRow.strike, expiry: topStrikeRow.expiration, type: topStrikeRow.optionType }
      : null,
    tape_coverage_tier: tapeCoverageTier,
    tape_occ_coverage_pct:
      tapeMetricRow && tapeMetricRow.occRequested > 0
        ? Math.round((tapeMetricRow.occCompleted / tapeMetricRow.occRequested) * 10000) / 100
        : null,
    tape_insert_coverage_pct:
      tapeMetricRow && tapeMetricRow.tradesAttemptedInsert > 0
        ? Math.round((tapeMetricRow.tradesInsertedCommitted / tapeMetricRow.tradesAttemptedInsert) * 10000) / 100
        : null,
    tape_any_truncated: tapeMetricRow?.anyTruncated ?? null,
    skew25_delta_reason: chainSummary?.skew25DeltaReason ?? null,
    earnings_date_conflict_sources: earningsDateConflict,
    iv_cleaned_ratio: ivCleanedRatio,
    iv_contamination_elevated: ivContaminationElevated,
    macro_density_count: macroWin.count,
  };

  const flowUpdatedAt = flowHl ? new Date() : null;

  const comps: ScannerComponentScoresV1 = {
    catalyst_term_shape: termShape.score,
    iv_vs_realized: ivRv.score,
    flow_quality: flowSc.score,
    earnings_edge_signature: earningsEdge.score,
    skew_anomaly: skewS.score,
    macro_density_in_window: macroWin.score,
    implied_move_richness: moveRich.score,
    liquidity_anchor_score: liqScore,
  };

  const surfacingReasons: string[] = [];
  if (termShape.reason) surfacingReasons.push(termShape.reason);
  if (ivRv.reason) surfacingReasons.push(ivRv.reason);
  if (flowSc.reason) surfacingReasons.push(flowSc.reason);
  if (skewS.reason) surfacingReasons.push(skewS.reason);
  if (macroWin.reason) surfacingReasons.push(macroWin.reason);

  const disqual: string[] = [];
  if (halted) disqual.push("halted");
  if (ivr == null) disqual.push("ivr_missing");
  if (atmOiFront != null && atmOiFront < 100) disqual.push("low_oi");
  const hasLiveFlowTape = tape?.tapeKind === "live" && tape.sessionAggregateSource === "live_raw_trades";
  if (!flowHl || (tapeCoverageTier === "not_run" && !hasLiveFlowTape)) disqual.push("tape_not_run");
  if (regimeShockActive) disqual.push("regime_shock");
  if (bidAskWidthAtmFront != null && bidAskWidthAtmFront > 0.3) disqual.push("wide_spread");
  if (ivCleanedRatio < 0.5 || ivContaminationElevated) disqual.push("iv_contamination");
  if (noCleanEarningsExpiry) disqual.push("no_clean_earnings_expiry");

  let composite = disqual.length > 0 ? 0 : scannerCompositeV1(comps);

  const chainAgeSec = chainUpdatedAt ? (Date.now() - chainUpdatedAt.getTime()) / 1000 : 9999;
  const flowAgeSec = flowUpdatedAt ? (Date.now() - flowUpdatedAt.getTime()) / 1000 : 9999;
  if (disqual.length === 0) {
    if (chainAgeSec > 90) composite *= 0.8;
    if (flowAgeSec > 300) composite *= 0.9;
  }

  const hvPts = hvToVolPoints(hv20);
  const iv30OverHv20 =
    frontWeekAtmIv != null && hvPts != null && hvPts > 0 ? frontWeekAtmIv / hvPts : null;
  const daysToNextCatalyst = earningsDaysAway;
  const callHeavy = (flowHl?.unusualCallVolume ?? 0) > (flowHl?.unusualPutVolume ?? 0) * 1.25;
  const putHeavy = (flowHl?.unusualPutVolume ?? 0) > (flowHl?.unusualCallVolume ?? 0) * 1.25;
  const px = spot && spot > 0 ? spot : 100;
  const blockCall = (flowHl?.totalCallVolume ?? 0) * px * 0.01;
  const blockPut = (flowHl?.totalPutVolume ?? 0) * px * 0.01;
  const directionalLean: "BULLISH" | "BEARISH" | "MIXED" | null =
    flowHl?.unusualSkew === "bullish" ? "BULLISH" : flowHl?.unusualSkew === "bearish" ? "BEARISH" : "MIXED";

  const edgeType: ScannerEdgeType = classifyEdgeType({
    iv30OverHv20,
    daysToNextCatalyst,
    ivr,
    frontAtmIvVolPoints: frontWeekAtmIv,
    backAtmIvVolPoints: nextWeekAtmIv,
    unusualCallFlowAskBias: callHeavy,
    unusualPutFlowAskBias: putHeavy,
    blockNotionalCallUsd: blockCall,
    blockNotionalPutUsd: blockPut,
    directionalLean,
  });

  const surfacedNames = surfacedSubScoresHigh(comps);

  const rowPayload: Record<string, unknown> = {
    sector,
    marketCapTier: tier,
    spot: spot != null ? String(spot) : null,
    dailyChangePct: dailyChangePct != null ? String(dailyChangePct) : null,
    halted,
    ivr: ivr != null ? String(ivr) : null,
    ivrSource,
    hv20: hv20 != null ? String(hv20) : null,
    hv30: hv30 != null ? String(hv30) : null,
    atmIvByExpiry: atmIvByExpiry.length ? atmIvByExpiry : null,
    skew25dByExpiry: skew25dByExpiry.length ? skew25dByExpiry : null,
    impliedMoveFrontPct: impliedMoveFrontPct != null ? String(impliedMoveFrontPct) : null,
    impliedMoveFrontAbs: impliedMoveFrontAbs != null ? String(impliedMoveFrontAbs) : null,
    atmOiFront,
    bidAskWidthAtmFront: bidAskWidthAtmFront != null ? String(bidAskWidthAtmFront) : null,
    flowSummary: flowSummary as unknown as Record<string, unknown>,
    earningsDate: earningsDateStr ?? null,
    earningsDaysAway,
    earningsConfirmed: earningsConfirmed ?? false,
    macroOverlapScore: String(Math.round(macroWin.score * 100) / 100),
    regimeShockActive,
    compositeScore: String(Math.round(composite * 100) / 100),
    componentScores: {
      ...comps,
      edge_type: edgeType,
      /** Legacy alias for older clients */
      catalyst_proximity: macroWin.score,
    } as unknown as Record<string, unknown>,
    earningsEdgeSignature: earningsEdge as unknown as Record<string, unknown>,
    impliedMoveRichness: moveRich as unknown as Record<string, unknown>,
    liquidityAnchorScore: String(Math.round(liqScore * 100) / 100),
    liquidityMaxOiBand: liqMaxOi,
    liquidityDeepestOiStrike: liqDeepStrike != null ? String(liqDeepStrike) : null,
    disqualFlags: disqual.length ? disqual : null,
    surfacingReasons: surfacingReasons.length ? surfacingReasons : null,
    snapshotAt: now,
    lastAttemptAt: attemptAt,
    lastSuccessAt: now,
    chainUpdatedAt,
    flowUpdatedAt,
    ivrUpdatedAt: eqRow?.date ? new Date(`${String(eqRow.date)}T00:00:00Z`) : null,
    earningsUpdatedAt: now,
    surfacingSubScores: surfacedNames.length ? surfacedNames : null,
  };

  await db
    .insert(tickerSignalSnapshotTable)
    .values({ ticker: upper, ...rowPayload })
    .onConflictDoUpdate({
      target: tickerSignalSnapshotTable.ticker,
      set: rowPayload,
    });

  const elapsedMs = Date.now() - tStart;
  return {
    elapsedMs,
    chainContractCount,
    tapeMetricRow,
    tapeCoverageTier,
  };
}

let workerTimer: ReturnType<typeof setInterval> | null = null;

async function runOneCycle(): Promise<void> {
  const cycleStarted = new Date();
  const failed: Array<{ ticker: string; error: string }> = [];
  let ok = 0;

  const { indicators } = getLiveMarketIndicatorsForPulse();
  const regimeShockActive = evaluateRegimeShock(indicators).shockActive;
  log.debug({ regimeShockActive }, "snapshot worker regime shock (evaluateRegimeShock)");

  const rowsForCoverage: Array<{
    ticker: string;
    chainContractCount: number;
    tapeMetricRow: typeof scannerTapeMetricsTable.$inferSelect | null;
    tapeCoverageTier: TapeCoverageTier;
    elapsedMs: number;
  }> = [];
  const succeededTickers = new Set<string>();

  const limit = pLimit(CONCURRENCY);
  await Promise.all(
    LC130.map((ticker) =>
      limit(async () => {
        try {
          const out = await refreshTicker(ticker, regimeShockActive);
          ok++;
          succeededTickers.add(ticker.toUpperCase());
          rowsForCoverage.push({
            ticker: ticker.toUpperCase(),
            chainContractCount: out.chainContractCount,
            tapeMetricRow: out.tapeMetricRow,
            tapeCoverageTier: out.tapeCoverageTier,
            elapsedMs: out.elapsedMs,
          });
        } catch (e) {
          failed.push({ ticker, error: e instanceof Error ? e.message : String(e) });
        }
      }),
    ),
  );

  for (const sym of LC130) {
    const u = sym.toUpperCase();
    if (!succeededTickers.has(u)) {
      rowsForCoverage.push({
        ticker: u,
        chainContractCount: 0,
        tapeMetricRow: null,
        tapeCoverageTier: "not_run",
        elapsedMs: 0,
      });
    }
  }

  const inserted = await db.insert(scannerHealthTable).values({
    cycleStartedAt: cycleStarted,
    cycleCompletedAt: new Date(),
    tickersAttempted: LC130.length,
    tickersSucceeded: ok,
    tickersFailed: failed.length,
    failedTickers: failed.length ? failed : null,
  }).returning({ id: scannerHealthTable.id });

  const cycleId = inserted[0]?.id;
  if (cycleId != null && rowsForCoverage.length > 0) {
    try {
      await db.insert(scannerTickerCycleCoverageTable).values(
        rowsForCoverage.map((r) => {
          const tm = r.tapeMetricRow;
          const occA = tm?.occRequested ?? 0;
          const occC = tm?.occCompleted ?? 0;
          const occPct =
            occA > 0 ? String(Math.round((occC / occA) * 10000) / 10000) : null;
          const tried = tm?.tradesAttemptedInsert ?? 0;
          const ins = tm?.tradesInsertedCommitted ?? 0;
          const insertPct =
            tried > 0 ? String(Math.round((ins / tried) * 10000) / 10000) : null;
          return {
            cycleId,
            ticker: r.ticker,
            chainContractCount: r.chainContractCount,
            occAttempted: occA,
            occCompleted: occC,
            occCoveragePct: occPct,
            tradesInserted: ins,
            tradesObserved: tm?.tradesObservedPolygon ?? null,
            insertCoveragePct: insertPct,
            truncated: tm?.anyTruncated ?? false,
            elapsedMs: r.elapsedMs,
            tier: r.tapeCoverageTier,
          };
        }),
      );
    } catch (err) {
      log.error({ err }, "scanner_ticker_cycle_coverage batch insert failed");
    }
  }
}

export function startSnapshotRefreshWorker(): void {
  if (workerTimer) return;
  log.info("snapshot worker started");
  void runOneCycle().catch((err) => log.error({ err }, "snapshot worker initial cycle failed"));
  workerTimer = setInterval(() => {
    if (!isSnapshotWorkerWindowEt()) return;
    void runOneCycle().catch((err) => log.error({ err }, "snapshot worker cycle failed"));
  }, REFRESH_INTERVAL_MS);
}
