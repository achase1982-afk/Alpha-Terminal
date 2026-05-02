import { db, optionsFlowRawTradesTable } from "@workspace/db";
import { logger } from "./logger.js";
import { logFlowPipelineWarn } from "./flowPipelineInstrumentation.js";
import { fetchPolygonChain } from "./polygonChain.js";
import { fetchSchwabMarketSnapshot } from "./schwabMarketSnapshot.js";
import { buildMarketContextSnapshot, type MarketCapTier } from "./flowMarketContext.js";
import {
  dteCalendarDays,
  sessionPhaseFromTradeMs,
  venueClassFromExchangeId,
} from "./flowTradeEnrichment.js";
import { classifyForFlowPersistence, shouldPersistBackfillRow } from "./optionsTradeClassifier.js";
import { getContract20dBaseline } from "./optionsBaselines.js";
import { runRollupOnceForSymbol } from "./optionsFlowRollup.js";
import { FlowLegWindow } from "./flowMultilegExtras.js";
import {
  buildTapeOccList,
  runStrategistTapeBackfill,
  type ChainSummaryLike,
  type TapeBackfillStatus,
} from "./strategistTapeBackfill.js";
import {
  lastCompletedTradingDayNy,
  nyCalendarYmd,
  rthBoundsMs,
  isMarketHoliday,
} from "./polygonMarketCalendar.js";
import {
  ensureConnected,
  getCurrentSubscriptionChannelCount,
  getNbbo,
  getRemainingChannelCapacity,
  getStatus,
  isEnabled as polygonWsEnabled,
  onTrade,
  subscribeContractsWithQuotes,
  unsubscribeContractsWithQuotes,
  type PolygonOptionTrade,
} from "./polygonOptionsWs.js";
import { getWatcherSubscribedContractCount } from "./optionsWatcher.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MIN_CAPTURE_MS = 10_000;
const MAX_CAPTURE_MS = 30_000;
const FLUSH_BATCH_MAX = 1_000;
const FLUSH_INTERVAL_MS = 5_000;
const CAPACITY_QUEUE_MS = 30_000;
const CHANNEL_POLL_MS = 200;

export type FlowCaptureSource = "websocket" | "rest" | "flat_file";

export interface FlowCaptureResult {
  sessionDate: string;
  source: FlowCaptureSource;
  rowsInserted: number;
  occsSubscribed: number;
  durationMs: number;
  errors: string[];
  tapeBackfill?: TapeBackfillStatus;
}

interface ChainLike {
  strike: number;
  expiration: string;
  type: string;
  optionType?: string;
  openInterest?: number;
  volume?: number;
}

export interface FlowCaptureOptions {
  sessionDate?: string;
  occs?: string[];
  minDurationMs?: number;
  timeout?: number;
  chain?: ChainLike[];
  chainSummary?: ChainSummaryLike;
  marketCapTier?: MarketCapTier | string;
}

const inflightByKey = new Map<string, Promise<FlowCaptureResult>>();
/** Concurrent callers awaiting the same ticker/session (for diagnostics). */
const refCountByKey = new Map<string, number>();

type MetricsSnapshot = {
  queueDepth: number;
  completedLastHour: number;
  failedLastHour: number;
  durationSumMs: number;
  durationCount: number;
  rowsSum: number;
  rowsCount: number;
};

const metrics: MetricsSnapshot = {
  queueDepth: 0,
  completedLastHour: 0,
  failedLastHour: 0,
  durationSumMs: 0,
  durationCount: 0,
  rowsSum: 0,
  rowsCount: 0,
};

const recentRequests: Array<{
  ticker: string;
  sessionDate: string;
  source: string;
  rowsInserted: number;
  durationMs: number;
  timestamp: string;
}> = [];

let metricsHourRotate = Date.now();

function rotateMetricsHour(): void {
  const now = Date.now();
  if (now - metricsHourRotate < 3_600_000) return;
  metricsHourRotate = now;
  metrics.completedLastHour = 0;
  metrics.failedLastHour = 0;
}

function pushRecent(r: (typeof recentRequests)[number]): void {
  recentRequests.unshift(r);
  if (recentRequests.length > 50) recentRequests.pop();
}

function sessionKey(ticker: string, sessionDate: string): string {
  return `${ticker.toUpperCase()}|${sessionDate}`;
}

function nyWeekdaySun0(d: Date): number {
  const ymd = nyCalendarYmd(d);
  const probe = new Date(`${ymd}T12:00:00`);
  const long = probe.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long" });
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const i = names.indexOf(long);
  return i >= 0 ? i : 0;
}

export async function resolveFlowSessionDate(opts: FlowCaptureOptions): Promise<string> {
  if (typeof opts.sessionDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(opts.sessionDate)) {
    return opts.sessionDate;
  }
  const now = new Date();
  const todayYmd = nyCalendarYmd(now);
  const wd = nyWeekdaySun0(now);
  if (wd === 0 || wd === 6) {
    return lastCompletedTradingDayNy(now);
  }
  if (await isMarketHoliday(todayYmd)) {
    return lastCompletedTradingDayNy(now);
  }
  const { openMs, closeMs } = await rthBoundsMs(todayYmd);
  const nowMs = now.getTime();
  if (nowMs >= openMs && nowMs < closeMs) {
    return todayYmd;
  }
  return lastCompletedTradingDayNy(now);
}

async function waitForCapacity(neededChannels: number, deadlineMs: number): Promise<boolean> {
  while (Date.now() < deadlineMs) {
    if (getRemainingChannelCapacity() >= neededChannels) return true;
    await new Promise((r) => setTimeout(r, CHANNEL_POLL_MS));
  }
  return false;
}

function mergeTape(rest: TapeBackfillStatus | undefined, fc: FlowCaptureResult): TapeBackfillStatus {
  const base =
    rest ??
    ({
      status: "skipped",
      reason: null,
      tapeBackfillReason: "skipped_other",
      sessionDate: fc.sessionDate,
      coverageEndMs: Date.now(),
      occRequested: 0,
      occCompleted: 0,
      tradesInserted: 0,
      totalTradesFromPolygon: 0,
      persistRejectedCount: 0,
      anyTruncated: false,
      anySawPolygonHttpError: false,
      todayYmd: nyCalendarYmd(new Date()),
      isSessionForToday: false,
      sessionInProgress: false,
      queryOpenMs: 0,
      queryCloseMs: 0,
    } satisfies TapeBackfillStatus);

  return {
    ...base,
    tradesInserted: Math.max(base.tradesInserted, fc.rowsInserted),
    totalTradesFromPolygon:
      fc.rowsInserted > 0
        ? Math.max(base.totalTradesFromPolygon ?? 0, fc.rowsInserted)
        : base.totalTradesFromPolygon,
    occRequested: fc.occsSubscribed > 0 ? fc.occsSubscribed : base.occRequested,
    occCompleted: fc.occsSubscribed > 0 ? fc.occsSubscribed : base.occCompleted,
    captureSource: fc.source,
    captureDurationMs: fc.durationMs,
    sessionDate: fc.sessionDate,
  };
}

async function resolveChainInputs(
  ticker: string,
  opts: FlowCaptureOptions,
): Promise<{ chain: ChainLike[]; summary: ChainSummaryLike; tier: MarketCapTier | string } | null> {
  if (opts.chain && opts.chainSummary) {
    const schwabSnap = await fetchSchwabMarketSnapshot(ticker);
    const marketCtx = buildMarketContextSnapshot({
      ticker,
      marketCapUsd: schwabSnap?.marketCapUsd ?? null,
      assetType: schwabSnap?.assetType ?? null,
    });
    return {
      chain: opts.chain,
      summary: opts.chainSummary,
      tier: opts.marketCapTier ?? marketCtx.tier,
    };
  }
  const apiKey = process.env["POLYGON_API_KEY"];
  if (!apiKey) return null;
  const chain = await fetchPolygonChain(ticker, apiKey, { maxDte: 120, maxPages: 6, log: logger });
  if (!chain?.underlyingPrice) return null;
  const calls = chain.calls ?? [];
  const puts = chain.puts ?? [];
  const chainLike: ChainLike[] = [];
  for (const c of calls) {
    chainLike.push({
      strike: c.strike,
      expiration: c.expiration,
      type: "call",
      optionType: "CALL",
      openInterest: c.openInterest,
      volume: c.volume,
    });
  }
  for (const p of puts) {
    chainLike.push({
      strike: p.strike,
      expiration: p.expiration,
      type: "put",
      optionType: "PUT",
      openInterest: p.openInterest,
      volume: p.volume,
    });
  }
  const atmStrike =
    [...calls].sort((a, b) => Math.abs(a.strike - chain.underlyingPrice) - Math.abs(b.strike - chain.underlyingPrice))[0]?.strike ??
    calls[0]?.strike ??
    0;
  const availableExpirations = [...new Set([...calls.map((c) => c.expiration), ...puts.map((p) => p.expiration)])].sort();
  const curatedExpirations = availableExpirations.slice(0, 6).map((expiration) => ({
    expiration,
    dte: Math.max(
      0,
      Math.round(
        (new Date(`${expiration}T20:00:00Z`).getTime() - Date.now()) / 86_400_000,
      ),
    ),
  }));
  const summary: ChainSummaryLike = {
    atmStrike,
    availableExpirations,
    curatedExpirations,
  };
  const schwabSnap = await fetchSchwabMarketSnapshot(ticker);
  const marketCtx = buildMarketContextSnapshot({
    ticker,
    marketCapUsd: schwabSnap?.marketCapUsd ?? null,
    assetType: schwabSnap?.assetType ?? null,
  });
  return { chain: chainLike, summary, tier: opts.marketCapTier ?? marketCtx.tier };
}

function parseOccMeta(occ: string): { expiration: string; strike: number; optionType: "call" | "put" } | null {
  const m = occ.match(/^O:([A-Z0-9.]+)(\d{6})([CP])(\d{8})$/);
  if (!m) return null;
  const [, , yymmdd, cp, strikeRaw] = m;
  const yy = 2000 + Number(yymmdd.slice(0, 2));
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  const expiration = `${yy}-${mm}-${dd}`;
  const strike = Number(strikeRaw) / 1000;
  const optionType = cp === "C" ? "call" : "put";
  return { expiration, strike, optionType };
}

function openInterestForOcc(chain: ChainLike[], meta: { expiration: string; strike: number; optionType: "call" | "put" }): number {
  const isCall = meta.optionType === "call";
  for (const c of chain) {
    if (c.expiration !== meta.expiration || c.strike !== meta.strike) continue;
    const ot = String(c.optionType ?? c.type).toUpperCase();
    if (isCall && ot !== "CALL" && c.type !== "call") continue;
    if (!isCall && ot !== "PUT" && c.type !== "put") continue;
    const oi = c.openInterest;
    if (typeof oi === "number" && Number.isFinite(oi) && oi >= 0) return Math.floor(oi);
  }
  return 0;
}

async function runWebsocketCaptureInternal(
  ticker: string,
  sessionDate: string,
  occList: string[],
  opts: FlowCaptureOptions,
): Promise<FlowCaptureResult> {
  const t0 = Date.now();
  const errors: string[] = [];
  let rowsInserted = 0;
  const minDur = Math.max(0, opts.minDurationMs ?? DEFAULT_MIN_CAPTURE_MS);
  const timeoutMs = opts.timeout ?? DEFAULT_TIMEOUT_MS;
  const deadline = t0 + timeoutMs;

  const neededChannels = occList.length * 2;
  metrics.queueDepth++;
  const okCap = await waitForCapacity(neededChannels, Math.min(deadline, t0 + CAPACITY_QUEUE_MS));
  metrics.queueDepth--;
  if (!okCap) {
    errors.push("capacity_queue_timeout");
    return {
      sessionDate,
      source: "websocket",
      rowsInserted: 0,
      occsSubscribed: 0,
      durationMs: Date.now() - t0,
      errors,
    };
  }

  const schwabSnap = await fetchSchwabMarketSnapshot(ticker);
  const marketCtx = buildMarketContextSnapshot({
    ticker,
    marketCapUsd: schwabSnap?.marketCapUsd ?? null,
    assetType: schwabSnap?.assetType ?? null,
  });
  const chainResolved = await resolveChainInputs(ticker, opts);
  const chain = chainResolved?.chain ?? opts.chain ?? [];

  const todayYmd = nyCalendarYmd(new Date());
  let restSegment: TapeBackfillStatus | undefined;
  if (sessionDate === todayYmd && chainResolved) {
    try {
      restSegment = await runStrategistTapeBackfill({
        ticker,
        chain: chainResolved.chain,
        chainSummary: chainResolved.summary,
        marketCapTier: chainResolved.tier,
        forcedSessionDate: todayYmd,
        budgetMs: Math.min(120_000, timeoutMs),
      });
      rowsInserted += restSegment.tradesInserted;
    } catch (err) {
      errors.push(`rest_segment:${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!polygonWsEnabled()) {
    const dur = Date.now() - t0;
    rotateMetricsHour();
    metrics.failedLastHour++;
    pushRecent({
      ticker,
      sessionDate,
      source: "rest",
      rowsInserted,
      durationMs: dur,
      timestamp: new Date().toISOString(),
    });
    return {
      sessionDate,
      source: "rest",
      rowsInserted,
      occsSubscribed: 0,
      durationMs: dur,
      errors: [...errors, "polygon_ws_disabled"],
      tapeBackfill: mergeTape(restSegment, {
        sessionDate,
        source: "rest",
        rowsInserted,
        occsSubscribed: 0,
        durationMs: dur,
        errors,
      }),
    };
  }

  let unregister: (() => void) | null = null;
  const buffer: Array<typeof optionsFlowRawTradesTable.$inferInsert> = [];
  let flushTimer: ReturnType<typeof setInterval> | null = null;
  const occSet = new Set(occList.map((o) => o.toUpperCase()));
  const legWindow = new FlowLegWindow();

  const flush = async (): Promise<void> => {
    if (buffer.length === 0) return;
    const batch = buffer.splice(0, buffer.length);
    try {
      const ins = await db
        .insert(optionsFlowRawTradesTable)
        .values(batch)
        .onConflictDoNothing({
          target: [
            optionsFlowRawTradesTable.underlyingSymbol,
            optionsFlowRawTradesTable.date,
            optionsFlowRawTradesTable.sourceTradeId,
          ],
        })
        .returning({ id: optionsFlowRawTradesTable.id });
      rowsInserted += ins.length;
    } catch (err) {
      logFlowPipelineWarn("flow_capture_flush", "flowCaptureService: bulk insert failed", { err, ticker, batchLen: batch.length });
      errors.push(`insert:${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const onTradeHandler = (trade: PolygonOptionTrade): void => {
    const sym = trade.sym.toUpperCase();
    if (!occSet.has(sym)) return;
    void (async () => {
      const nb = getNbbo(sym);
      const meta = parseOccMeta(sym);
      if (!meta) return;
      let baselineAvgVol: number | null = null;
      try {
        const bl = await getContract20dBaseline(sym, { referenceDate: new Date(`${sessionDate}T12:00:00Z`) });
        baselineAvgVol = bl?.avgVolume ?? null;
      } catch {
        /* ignore */
      }
      const oiSnap = openInterestForOcc(chain, meta);
      const cl = classifyForFlowPersistence({
        price: trade.price,
        size: trade.size,
        conditions: trade.conditions,
        nbbo: nb ? { bid: nb.bid, ask: nb.ask } : null,
        largeNotionalThresholdUsd: marketCtx.largeNotionalThresholdUsd,
        avgDailyContractVolume20d: baselineAvgVol,
        openInterest: oiSnap > 0 ? oiSnap : null,
      });
      if (!shouldPersistBackfillRow(cl)) return;
      const tsMs = trade.timestamp;
      const dteDays = dteCalendarDays(meta.expiration, tsMs);
      const sessionPhase = sessionPhaseFromTradeMs(tsMs);
      const venueClass = venueClassFromExchangeId(trade.exchange);
      const dedupId = `ws:${sym}:${trade.timestamp}:${trade.exchange}:${trade.price}:${trade.size}`;
      const sample = {
        tsMs,
        occ: sym,
        strike: meta.strike,
        expiration: meta.expiration,
        side: cl.side,
        size: trade.size,
        notional: cl.notional,
      };
      const ml = legWindow.annotate(ticker, sample);
      legWindow.record(ticker, sample);
      buffer.push({
        underlyingSymbol: ticker,
        date: sessionDate,
        timestamp: new Date(tsMs),
        optionSymbol: sym,
        optionType: meta.optionType,
        strike: meta.strike,
        expiration: meta.expiration,
        tradePrice: trade.price,
        size: trade.size,
        notional: cl.notional,
        side: cl.side,
        isBlock: cl.isBlockForDb,
        isSweep: cl.isSweep,
        sourceTradeId: dedupId,
        exchangeId: trade.exchange,
        venueClass,
        dteDays,
        sessionPhase,
        volOiRatio: cl.volOiRatio,
        openInterestSnapshot: oiSnap > 0 ? oiSnap : null,
        volumeVsBaseline20d: cl.volumeVsBaseline20d,
        marketCapUsd: marketCtx.marketCapUsd,
        marketCapTier: marketCtx.tier,
        notionalThresholdUsd: marketCtx.largeNotionalThresholdUsd,
        aggressorConfidence: cl.aggressorConfidence,
        syntheticLegGroupId: ml.syntheticLegGroupId,
        multiLegConfidence: ml.multiLegConfidence,
        extras: ml.extras,
      });
      if (buffer.length >= FLUSH_BATCH_MAX) await flush();
    })();
  };

  try {
    await ensureConnected();
    unregister = onTrade(onTradeHandler);
    await subscribeContractsWithQuotes(occList);
    logger.info({ ticker, sessionDate, occs: occList.length }, "flowCapture: subscribed");
    flushTimer = setInterval(() => { void flush(); }, FLUSH_INTERVAL_MS);

    const subscribeTs = Date.now();
    const maxEnd = Math.min(subscribeTs + MAX_CAPTURE_MS, deadline);
    while (Date.now() < subscribeTs + minDur && Date.now() < maxEnd) {
      await new Promise((r) => setTimeout(r, 100));
      const st = getStatus();
      if (st.connectionState !== "connected") {
        errors.push("websocket_disconnected_mid_capture");
        break;
      }
    }
    while (Date.now() < maxEnd - 50 && Date.now() - subscribeTs < MAX_CAPTURE_MS) {
      await new Promise((r) => setTimeout(r, 50));
    }
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  } finally {
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    await flush();
    if (unregister) unregister();
    try {
      unsubscribeContractsWithQuotes(occList);
    } catch (err) {
      errors.push(`unsubscribe:${err instanceof Error ? err.message : String(err)}`);
    }
    logger.info({ ticker, rowsInserted }, "flowCapture: flushed");
    logger.info({ ticker }, "flowCapture: unsubscribed");
    try {
      await runRollupOnceForSymbol(ticker, sessionDate);
    } catch (err) {
      logFlowPipelineWarn("flow_capture_rollup", "flowCaptureService: rollup failed", { err, ticker });
    }
  }

  const dur = Date.now() - t0;
  rotateMetricsHour();
  metrics.completedLastHour++;
  metrics.durationSumMs += dur;
  metrics.durationCount++;
  metrics.rowsSum += rowsInserted;
  metrics.rowsCount++;
  pushRecent({
    ticker,
    sessionDate,
    source: "websocket",
    rowsInserted,
    durationMs: dur,
    timestamp: new Date().toISOString(),
  });

  const fc: FlowCaptureResult = {
    sessionDate,
    source: rowsInserted > 0 ? "websocket" : "websocket",
    rowsInserted,
    occsSubscribed: occList.length,
    durationMs: dur,
    errors,
    tapeBackfill: mergeTape(restSegment, {
      sessionDate,
      source: "websocket",
      rowsInserted,
      occsSubscribed: occList.length,
      durationMs: dur,
      errors,
    }),
  };

  if (errors.some((e) => e.includes("websocket_disconnected"))) {
    const resolved = await resolveChainInputs(ticker, opts);
    if (resolved) {
      try {
        const fb = await runStrategistTapeBackfill({
          ticker,
          chain: resolved.chain,
          chainSummary: resolved.summary,
          marketCapTier: resolved.tier,
          forcedSessionDate: sessionDate,
          budgetMs: 120_000,
        });
        fc.rowsInserted += fb.tradesInserted;
        fc.source = "rest";
        fc.errors.push("fallback_rest_after_ws_disconnect");
        fc.tapeBackfill = mergeTape(fb, {
          ...fc,
          rowsInserted: fc.rowsInserted,
          source: "rest",
        });
      } catch (err) {
        fc.errors.push(`fallback_rest:${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  return fc;
}

async function runCaptureOnce(ticker: string, sessionDate: string, opts: FlowCaptureOptions): Promise<FlowCaptureResult> {
  const t0 = Date.now();
  const errors: string[] = [];

  logger.info({ ticker, sessionDate, source: "routing" }, "flowCapture: request received");

  let occList = opts.occs?.length ? [...opts.occs] : [];
  const resolved = await resolveChainInputs(ticker, opts);
  if (!occList.length && resolved) {
    const { occs } = buildTapeOccList(ticker, resolved.chain, resolved.summary, resolved.tier);
    occList = occs;
  }

  const todayYmd = nyCalendarYmd(new Date());
  const nowMs = Date.now();
  const { openMs: todayOpen, closeMs: todayClose } = await rthBoundsMs(todayYmd);
  const inRthToday = sessionDate === todayYmd && nowMs >= todayOpen && nowMs < todayClose;

  if (!occList.length) {
    errors.push("no_occs");
    const restFallback = resolved
      ? await runStrategistTapeBackfill({
          ticker,
          chain: resolved.chain,
          chainSummary: resolved.summary,
          marketCapTier: resolved.tier,
          forcedSessionDate: sessionDate,
        }).catch((e) => {
          errors.push(String(e));
          return undefined;
        })
      : undefined;
    return {
      sessionDate,
      source: "rest",
      rowsInserted: restFallback?.tradesInserted ?? 0,
      occsSubscribed: 0,
      durationMs: Date.now() - t0,
      errors,
      tapeBackfill: restFallback,
    };
  }

  if (polygonWsEnabled() && inRthToday) {
    return runWebsocketCaptureInternal(ticker, sessionDate, occList, opts);
  }

  if (!resolved) {
    return {
      sessionDate,
      source: "rest",
      rowsInserted: 0,
      occsSubscribed: 0,
      durationMs: Date.now() - t0,
      errors: [...errors, "no_chain"],
    };
  }

  const tb = await runStrategistTapeBackfill({
    ticker,
    chain: resolved.chain,
    chainSummary: resolved.summary,
    marketCapTier: resolved.tier,
    forcedSessionDate: sessionDate,
  });
  const dur = Date.now() - t0;
  rotateMetricsHour();
  metrics.completedLastHour++;
  metrics.durationSumMs += dur;
  metrics.durationCount++;
  metrics.rowsSum += tb.tradesInserted;
  metrics.rowsCount++;
  pushRecent({
    ticker,
    sessionDate,
    source: "rest",
    rowsInserted: tb.tradesInserted,
    durationMs: dur,
    timestamp: new Date().toISOString(),
  });

  return {
    sessionDate,
    source: "rest",
    rowsInserted: tb.tradesInserted,
    occsSubscribed: tb.occRequested,
    durationMs: dur,
    errors,
    tapeBackfill: tb,
  };
}

export async function requestFlowCapture(ticker: string, opts?: FlowCaptureOptions): Promise<FlowCaptureResult> {
  const sym = ticker.toUpperCase();
  const sessionDate = await resolveFlowSessionDate(opts ?? {});
  const key = sessionKey(sym, sessionDate);

  refCountByKey.set(key, (refCountByKey.get(key) ?? 0) + 1);

  const wrapDec = (p: Promise<FlowCaptureResult>) =>
    p.finally(() => {
      const n = (refCountByKey.get(key) ?? 1) - 1;
      if (n <= 0) refCountByKey.delete(key);
      else refCountByKey.set(key, n);
    });

  let p = inflightByKey.get(key);
  if (!p) {
    p = runCaptureOnce(sym, sessionDate, opts ?? {})
      .catch((err): FlowCaptureResult => {
        rotateMetricsHour();
        metrics.failedLastHour++;
        return {
          sessionDate,
          source: "rest",
          rowsInserted: 0,
          occsSubscribed: 0,
          durationMs: 0,
          errors: [err instanceof Error ? err.message : String(err)],
        };
      })
      .finally(() => {
        inflightByKey.delete(key);
      });
    inflightByKey.set(key, p);
  }

  return wrapDec(p);
}

export function getFlowCaptureDiagnostics(): {
  websocket: {
    connected: boolean;
    currentSubscriptions: number;
    remainingCapacity: number;
    watcherSubscriptions: number;
    flowCaptureSubscriptions: number;
    nbboCacheSize: number;
  };
  flowCapture: {
    activeRequests: Array<{ ticker: string; sessionDate: string; refCount: number; ageMs: number }>;
    queueDepth: number;
    completedLastHour: number;
    failedLastHour: number;
    avgDurationMs: number;
    avgRowsInserted: number;
  };
  recentRequests: typeof recentRequests;
} {
  const st = getStatus();
  const watcherSubs = getWatcherSubscribedContractCount();
  const used = getCurrentSubscriptionChannelCount();
  const flowCaptureApprox = Math.max(0, used - watcherSubs * 2);

  const avgDur =
    metrics.durationCount > 0 ? Math.round(metrics.durationSumMs / metrics.durationCount) : 0;
  const avgRows =
    metrics.rowsCount > 0 ? Math.round(metrics.rowsSum / metrics.rowsCount) : 0;

  return {
    websocket: {
      connected: st.connectionState === "connected",
      currentSubscriptions: used,
      remainingCapacity: getRemainingChannelCapacity(),
      watcherSubscriptions: watcherSubs,
      flowCaptureSubscriptions: flowCaptureApprox,
      nbboCacheSize: st.nbboCacheSize,
    },
    flowCapture: {
      activeRequests: [...inflightByKey.keys()].map((k) => {
        const [ticker, sessionDate] = k.split("|");
        return {
          ticker: ticker ?? "",
          sessionDate: sessionDate ?? "",
          refCount: refCountByKey.get(k) ?? 1,
          ageMs: 0,
        };
      }),
      queueDepth: metrics.queueDepth,
      completedLastHour: metrics.completedLastHour,
      failedLastHour: metrics.failedLastHour,
      avgDurationMs: avgDur,
      avgRowsInserted: avgRows,
    },
    recentRequests: [...recentRequests],
  };
}
