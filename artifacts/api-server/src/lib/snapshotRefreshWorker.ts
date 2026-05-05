/**
 * Background refresh of ticker_signal_snapshot for LC130 (30s cadence in session window).
 */
import pLimit from "p-limit";
import { desc, eq } from "drizzle-orm";
import { db, equityDailyTable, scannerHealthTable, tickerSignalSnapshotTable } from "@workspace/db";
import { LIQUID_CORE_SYMBOL_STRINGS } from "../data/liquidCore130.js";
import { fetchPolygonChain, type PolygonParsedContract } from "./polygonChain.js";
import { getNextEarningsDate } from "./earningsService.js";
import { getUpcomingEvents } from "./calendarEventChecker.js";
import { getPolygonFlowHighlights } from "./polygonFlowHighlights.js";
import { evaluateRegimeShock } from "./regimeShockDetector.js";
import { getLiveMarketIndicatorsForPulse } from "./liveMarketIndicators.js";
import { impliedVolToVolPoints, classifyEdgeType, type ScannerEdgeType } from "./scannerEdgeType.js";
import { getScannerSector } from "./scannerSectorMap.js";
import { logger } from "./logger.js";
import { isSnapshotWorkerScheduledWindowEt } from "./snapshotWorkerSchedule.js";

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

function scoreTermStructure(frontIv: number | null, nextIv: number | null): { score: number; reason: string | null } {
  if (frontIv == null || nextIv == null) return { score: 0, reason: null };
  const spread = frontIv - nextIv;
  if (spread <= 0) return { score: 0, reason: null };
  let score = 0;
  if (spread <= 5) score = spread * 4;
  else if (spread <= 15) score = 20 + (spread - 5) * 4;
  else score = Math.min(100, 60 + (spread - 15) * 2.5);
  const reason =
    score > 50
      ? `front IV ${frontIv.toFixed(1)} vs next IV ${nextIv.toFixed(1)}, ${spread.toFixed(1)} vol pt spread`
      : null;
  return { score: Math.min(100, score), reason };
}

function scoreIvVsRealized(frontIv: number | null, hv20: number | null): { score: number; reason: string | null } {
  const hvPts = hvToVolPoints(hv20);
  if (frontIv == null || hvPts == null) return { score: 0, reason: null };
  const gap = frontIv - hvPts;
  if (gap <= 0) return { score: 0, reason: null };
  const score = Math.min(100, gap * 5);
  const reason =
    score > 60
      ? `front IV ${frontIv.toFixed(1)} vs HV20 ${hvPts.toFixed(1)}, ${gap.toFixed(1)} vol pts rich`
      : null;
  return { score, reason };
}

function scoreSkew(skewPts: number | null): { score: number; reason: string | null } {
  if (skewPts == null || !Number.isFinite(skewPts)) return { score: 0, reason: null };
  const absSkew = Math.abs(skewPts);
  let score = 0;
  if (absSkew < 2) score = 0;
  else if (absSkew < 5) score = (absSkew - 2) * 15;
  else if (absSkew < 10) score = 45 + (absSkew - 5) * 8;
  else score = Math.min(100, 85 + (absSkew - 10) * 2);
  const reason =
    score > 50 ? `25Δ skew ${skewPts.toFixed(2)} vol pts, outside normal range` : null;
  return { score: Math.min(100, score), reason };
}

function scoreCatalyst(
  earningsDays: number | null,
  confirmed: boolean,
  macroScore: number,
): { score: number; reason: string | null } {
  let catalystPart = 0;
  if (earningsDays != null && Number.isFinite(earningsDays)) {
    if (earningsDays <= 3 && confirmed) catalystPart = 100;
    else if (earningsDays <= 7 && confirmed) catalystPart = 75;
    else if (earningsDays <= 14) catalystPart = 40;
  }
  const score = Math.max(catalystPart, macroScore);
  const reason = score > 60 ? `catalyst/macro score ${score.toFixed(0)}` : null;
  return { score: Math.min(100, score), reason };
}

function macroOverlapScore(): number {
  const ev = getUpcomingEvents(5);
  let s = 0;
  for (const e of ev) {
    if (e.importance === "HIGH") s += 40;
    else if (e.importance === "MEDIUM") s += 20;
    else s += 8;
  }
  return Math.min(100, s);
}

async function refreshTicker(ticker: string, regimeShockActive: boolean): Promise<void> {
  const upper = ticker.toUpperCase();
  const now = new Date();
  const attemptAt = now;


  const [chain, earn, flowHl, eqRow] = await Promise.all([
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

  let atmIvByExpiry: Array<{ expiry: string; days_to_exp: number; atm_iv: number }> = [];
  let skew25dByExpiry: Array<{ expiry: string; put_iv_25d: number; call_iv_25d: number; skew_pts: number }> = [];
  let impliedMoveFrontPct: number | null = null;
  let impliedMoveFrontAbs: number | null = null;
  let atmOiFront: number | null = null;
  let bidAskWidthAtmFront: number | null = null;
  let frontWeekAtmIv: number | null = null;
  let nextWeekAtmIv: number | null = null;
  let skewPtsFront: number | null = null;
  let chainUpdatedAt: Date | null = null;
  let frontExp: string | null = null;
  let nextExp: string | null = null;

  if (chain && spot && spot > 0) {
    chainUpdatedAt = new Date();
    const pn = pickFrontNextExpiries(chain.calls, chain.puts);
    frontExp = pn.front;
    nextExp = pn.next;

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

    if (frontExp) {
      const { calls: cF, puts: pF } = contractsForExpiry(chain.calls, chain.puts, frontExp);
      frontWeekAtmIv = interpolateIvAtSpot(cF, spot);
      const p25f = closestDeltaIv(pF, -0.25);
      const c25f = closestDeltaIv(cF, 0.25);
      if (p25f && c25f) skewPtsFront = p25f.iv - c25f.iv;

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

  const macroScore = macroOverlapScore();
  const earningsDateStr = earn.earningsDate;
  const earningsDaysAway = earn.daysAway;
  const earningsConfirmed = earn.confirmed;

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

  let tapeQuality: "complete" | "partial" | "degraded" | "not_run" = "not_run";
  if (tape?.tapeKind === "live" && tape.sessionAggregateSource === "live_raw_trades") tapeQuality = "complete";
  else if (tape?.tapeKind === "eod_fallback" && tape.sessionAggregateSource === "eod_volume_only") tapeQuality = "partial";
  if (!flowHl) tapeQuality = "not_run";

  const topStrikeRow = flowHl?.topByVolume?.[0];
  const totalN = askNotional + bidNotional + midNotional;
  const askPct = totalN > 0 ? (askNotional / totalN) * 100 : 0;
  const flowSummary = {
    ask_notional: askNotional,
    bid_notional: bidNotional,
    mid_notional: midNotional,
    ask_pct: askPct,
    top_strike: topStrikeRow
      ? { strike: topStrikeRow.strike, expiry: topStrikeRow.expiration, type: topStrikeRow.optionType }
      : null,
    tape_quality: tapeQuality,
  };

  const flowUpdatedAt = flowHl ? new Date() : null;

  const term = scoreTermStructure(frontWeekAtmIv, nextWeekAtmIv);
  const ivRv = scoreIvVsRealized(frontWeekAtmIv, hv20);
  const skewS = scoreSkew(skewPtsFront);
  const catS = scoreCatalyst(earningsDaysAway, earningsConfirmed ?? false, macroScore);

  const th = flowNotionalThreshold(tier);
  let flowScore = 0;
  let flowReason: string | null = null;
  if (tapeQuality === "not_run" || tapeQuality === "degraded") {
    flowScore = 0;
  } else if (askNotional < th) {
    flowScore = 0;
  } else {
    const denom = askNotional + bidNotional + midNotional;
    const askShare = denom > 0 ? askNotional / denom : 0;
    const mult = clamp(askNotional / th, 1, 3);
    flowScore = Math.min(100, askShare * 100 * (mult / 3));
    if (flowScore > 60 && topStrikeRow) {
      flowReason = `${askPct.toFixed(0)}% ask-side flow on ${topStrikeRow.optionType} ${topStrikeRow.strike}, $${Math.round(askNotional)} notional`;
    }
  }

  const componentScores = {
    term_structure: term.score,
    iv_vs_realized: ivRv.score,
    flow_alignment: flowScore,
    skew_anomaly: skewS.score,
    catalyst_proximity: catS.score,
  };

  const surfacingReasons: string[] = [];
  if (term.reason) surfacingReasons.push(term.reason);
  if (ivRv.reason) surfacingReasons.push(ivRv.reason);
  if (flowReason) surfacingReasons.push(flowReason);
  if (skewS.reason) surfacingReasons.push(skewS.reason);
  if (catS.reason) surfacingReasons.push(catS.reason);

  const disqual: string[] = [];
  if (halted) disqual.push("halted");
  if (ivr == null) disqual.push("ivr_missing");
  if (atmOiFront != null && atmOiFront < 100) disqual.push("low_oi");
  if (tapeQuality === "not_run") disqual.push("tape_not_run");
  if (regimeShockActive) disqual.push("regime_shock");
  if (bidAskWidthAtmFront != null && bidAskWidthAtmFront > 0.3) disqual.push("wide_spread");

  let composite =
    disqual.length > 0
      ? 0
      : term.score * 0.3 +
        flowScore * 0.25 +
        ivRv.score * 0.2 +
        catS.score * 0.15 +
        skewS.score * 0.1;

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

  const rowPayload = {
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
    macroOverlapScore: String(macroScore),
    regimeShockActive,
    compositeScore: String(Math.round(composite * 100) / 100),
    componentScores: { ...componentScores, edge_type: edgeType } as unknown as Record<string, unknown>,
    disqualFlags: disqual.length ? disqual : null,
    surfacingReasons: surfacingReasons.length ? surfacingReasons : null,
    snapshotAt: now,
    lastAttemptAt: attemptAt,
    lastSuccessAt: now,
    chainUpdatedAt,
    flowUpdatedAt,
    ivrUpdatedAt: eqRow?.date ? new Date(`${String(eqRow.date)}T00:00:00Z`) : null,
    earningsUpdatedAt: now,
  };

  await db
    .insert(tickerSignalSnapshotTable)
    .values({ ticker: upper, ...rowPayload })
    .onConflictDoUpdate({
      target: tickerSignalSnapshotTable.ticker,
      set: rowPayload,
    });
}

let workerTimer: ReturnType<typeof setInterval> | null = null;

async function runOneCycle(): Promise<void> {
  const cycleStarted = new Date();
  const failed: Array<{ ticker: string; error: string }> = [];
  let ok = 0;

  const { indicators } = getLiveMarketIndicatorsForPulse();
  const regimeShockActive = evaluateRegimeShock(indicators).shockActive;
  log.debug({ regimeShockActive }, "snapshot worker regime shock (evaluateRegimeShock)");

  const limit = pLimit(CONCURRENCY);
  await Promise.all(
    LC130.map((ticker) =>
      limit(async () => {
        try {
          await refreshTicker(ticker, regimeShockActive);
          ok++;
        } catch (e) {
          failed.push({ ticker, error: e instanceof Error ? e.message : String(e) });
        }
      }),
    ),
  );
  await db.insert(scannerHealthTable).values({
    cycleStartedAt: cycleStarted,
    cycleCompletedAt: new Date(),
    tickersAttempted: LC130.length,
    tickersSucceeded: ok,
    tickersFailed: failed.length,
    failedTickers: failed.length ? failed : null,
  });
}

export function startSnapshotRefreshWorker(): void {
  if (workerTimer) return;
  log.info("snapshot worker started");
  void runOneCycle().catch((err) => log.error({ err }, "snapshot worker initial cycle failed"));
  workerTimer = setInterval(() => {
    if (!isSnapshotWorkerScheduledWindowEt()) return;
    void runOneCycle().catch((err) => log.error({ err }, "snapshot worker cycle failed"));
  }, REFRESH_INTERVAL_MS);
}
