import { logger } from "./logger.js";
import { enqueueClassifiedTrade } from "./optionsFlowPersistence.js";
import { classifyForFlowPersistence } from "./optionsTradeClassifier.js";
import { logFlowPipelineWarn } from "./flowPipelineInstrumentation.js";
import { fetchPolygonChain, type PolygonParsedContract } from "./polygonChain.js";
import {
  ensureConnected,
  isEnabled as polygonOptionsWsEnabled,
  getNbbo,
  onTrade,
  subscribeContractsWithQuotes,
  unsubscribeContractsWithQuotes,
  type PolygonOptionTrade,
} from "./polygonOptionsWs.js";
import { fetchSchwabMarketSnapshot } from "./schwabMarketSnapshot.js";
import { buildMarketContextSnapshot } from "./flowMarketContext.js";
import {
  dteCalendarDays,
  sessionPhaseFromTradeMs,
  venueClassFromExchangeId,
} from "./flowTradeEnrichment.js";
import { getContracts20dBaselineBatch } from "./optionsBaselines.js";

function parseOccLocal(occ: string): { expiration: string } | null {
  if (!occ.startsWith("O:")) return null;
  const body = occ.slice(2);
  const m = body.match(/^([A-Z0-9.]+?)(\d{6})([CP])(\d{8})$/);
  if (!m) return null;
  const [, , yymmdd] = m;
  const yy = 2000 + Number(yymmdd.slice(0, 2));
  const mm = yymmdd.slice(2, 4);
  const dd = yymmdd.slice(4, 6);
  return { expiration: `${yy}-${mm}-${dd}` };
}

// ── Persistent Polygon options watcher (Part 2) ──────────────────────
//
// Long-running singleton that maintains a 3-tier watchlist of underlying
// tickers, resolves OCC contracts via fetchPolygonChain for each, and
// subscribes to a bounded HOT+WARM subset on the shared options WS. Trades
// are accumulated into a per-ticker session log so the deterministic
// scanner can read live `liveEventCount` / `directionallyBalanced` inputs
// for the LIVE_FLOW bucket without doing its own one-shot scan.
//
// Tier semantics:
//   HOT  — subscribed now (top scanner candidates / largest premium).
//   WARM — subscribed now if budget allows, otherwise queued for promotion.
//   COLD — tracked but not subscribed; eligible for promotion next refresh.
//
// Sizing (1-vCPU container, see replit.md sizing note):
//   HOT_TICKERS_MAX × CONTRACTS_PER_HOT  + WARM_TICKERS_MAX × CONTRACTS_PER_WARM
//   30              × 8                  + 50               × 4              = 440
//   (well under polygonOptionsWs MAX_CONCURRENT_SUBS=1000 cap)
//
// Reconnect handling lives entirely in polygonOptionsWs.ts (ref-counted
// subs are replayed on auth_success). The watcher only re-issues
// subscribe calls on its own refresh tick if the WS recovers.

const HOT_TICKERS_MAX = 30;
const WARM_TICKERS_MAX = 50;
const CONTRACTS_PER_HOT = 8;
const CONTRACTS_PER_WARM = 4;
const TOTAL_SUB_BUDGET = 600;

// How long a session-log event is retained before it ages out.
const SESSION_EVENT_TTL_MS = 30 * 60 * 1000;
// Coverage / heartbeat thresholds for the LIVE/AMBER/EOD badge.
const HEARTBEAT_FRESH_MS = 60 * 1000;
const HEARTBEAT_STALE_MS = 5 * 60 * 1000;
// "Block print" threshold (size in contracts) and sweep condition set
// come from the canonical condition-code module so the watcher, SSE
// hub, REST backfill, and historical scanner all agree. SWEEP/BLOCK
// are imported at the top of this file.
// Chain refresh — chains drift across the day as new strikes list / OI fills.
const CHAIN_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
// Watcher tick cadence for periodic prune + tier reconciliation.
const WATCHER_TICK_INTERVAL_MS = 60 * 1000;
const MARKET_SNAPSHOT_TTL_MS = 4 * 60 * 60 * 1000;
export type Tier = "HOT" | "WARM" | "COLD";

export interface WatchlistInput {
  hot: string[];
  warm: string[];
  cold?: string[];
}

interface PerTickerState {
  ticker: string;
  tier: Tier;
  contracts: string[];          // OCC symbols currently (or last) subscribed
  callNotional: number;
  putNotional: number;
  liveEventCount: number;       // breakouts (sweep/block/large prints) in session
  largestPrintSize: number;
  largestPrintNotional: number;
  totalPrints: number;
  events: SessionEvent[];       // recent breakout events (TTL-pruned)
  lastTradeTs: number;
  lastChainRefreshTs: number;
  contractType: Map<string, "C" | "P">; // OCC → side, for directional balance
  /** Latest chain row per subscribed OCC (OI, volume for classification). */
  chainByOcc: Map<string, { openInterest: number; volume: number }>;
  /** 20d avg daily contract volume per OCC (polygon_options_history batch). */
  contractBaselineAvgVol20d: Map<string, number>;
  /** Schwab market snapshot for tiered notional thresholds. */
  marketContext: import("./flowMarketContext.js").MarketContextSnapshot | null;
  marketSnapshotFetchedAt: number;
}

interface SessionEvent {
  ts: number;
  occ: string;
  size: number;
  price: number;
  notional: number;
  kind: "sweep" | "block" | "large" | "volume_spike";
}

export interface SessionStats {
  ticker: string;
  tier: Tier;
  liveEventCount: number;
  callNotional: number;
  putNotional: number;
  directionallyBalanced: boolean;
  largestPrintSize: number;
  largestPrintNotional: number;
  totalPrints: number;
  contractsSubscribed: number;
  lastTradeTs: number | null;
  lastChainRefreshTs: number | null;
}

export interface WatcherStatus {
  enabled: boolean;
  running: boolean;
  startedAt: number | null;
  lastTickTs: number | null;
  lastTradeTs: number | null;
  hotCount: number;
  warmCount: number;
  coldCount: number;
  totalSubscribed: number;
  budgetCap: number;
  coverageRate: number;          // tickers with at least 1 event / hot+warm
}

const state = new Map<string, PerTickerState>();
const occToTicker = new Map<string, string>();
let unregisterTradeHandler: (() => void) | null = null;
let watcherTimer: ReturnType<typeof setInterval> | null = null;
let running = false;
let startedAt: number | null = null;
let lastTickTs: number | null = null;
let lastTradeTs: number | null = null;

// ── Public API ───────────────────────────────────────────────────────

export function isWatcherEnabled(): boolean {
  return polygonOptionsWsEnabled();
}

export function isWatcherRunning(): boolean {
  return running;
}

export async function startOptionsWatcher(): Promise<void> {
  if (!isWatcherEnabled()) {
    logger.info({ op: "watcher.start.skipped" },
      "Options watcher: POLYGON_OPTIONS_WS_ENABLED not set — skipping startup");
    return;
  }
  if (running) return;
  running = true;
  startedAt = Date.now();

  unregisterTradeHandler = onTrade(handleTrade);

  // Eagerly establish the WS so the first scan-driven setWatchlist doesn't
  // pay the connect+auth latency on its critical path.
  try {
    await ensureConnected();
  } catch (err) {
    logger.warn({ err, op: "watcher.start.ensureConnected.failed" },
      "Options watcher: initial connect failed — will retry on next setWatchlist");
  }

  watcherTimer = setInterval(() => { void watcherTick(); }, WATCHER_TICK_INTERVAL_MS);
  watcherTimer.unref?.();

  logger.info({
    op: "watcher.start",
    hotMax: HOT_TICKERS_MAX, warmMax: WARM_TICKERS_MAX,
    contractsPerHot: CONTRACTS_PER_HOT, contractsPerWarm: CONTRACTS_PER_WARM,
    totalBudget: TOTAL_SUB_BUDGET,
  }, "Options watcher started");
}

export function stopOptionsWatcher(): void {
  if (!running) return;
  if (watcherTimer) { clearInterval(watcherTimer); watcherTimer = null; }
  if (unregisterTradeHandler) { unregisterTradeHandler(); unregisterTradeHandler = null; }
  // Best-effort unsubscribe everything we own.
  const allOcc: string[] = [];
  for (const ts of state.values()) allOcc.push(...ts.contracts);
  if (allOcc.length) {
    try { unsubscribeContractsWithQuotes(allOcc); } catch (err) {
      logger.warn({ err, op: "watcher.stop.unsubscribe.failed" }, "watcher.stop unsubscribe");
    }
  }
  state.clear();
  occToTicker.clear();
  running = false;
  startedAt = null;
  logger.info({ op: "watcher.stop" }, "Options watcher stopped");
}

/**
 * Replace the watchlist. Idempotent: tickers staying in the same tier are
 * untouched, demotions release subs, promotions resolve chains lazily on
 * the next watcherTick (or immediately when budget allows).
 *
 * Cold tickers are tracked (so subsequent scans can promote without losing
 * any partial state) but never subscribed.
 */
export async function setWatchlist(input: WatchlistInput): Promise<void> {
  if (!isWatcherEnabled()) return;
  if (!running) {
    logger.warn({ op: "watcher.setWatchlist.notRunning" },
      "setWatchlist called but watcher not running — ignoring");
    return;
  }

  const hot = uniqUpper(input.hot).slice(0, HOT_TICKERS_MAX);
  const warm = uniqUpper(input.warm).slice(0, WARM_TICKERS_MAX);
  const cold = uniqUpper(input.cold ?? []).slice(0, 200);

  const desiredTier = new Map<string, Tier>();
  for (const t of hot) desiredTier.set(t, "HOT");
  for (const t of warm) if (!desiredTier.has(t)) desiredTier.set(t, "WARM");
  for (const t of cold) if (!desiredTier.has(t)) desiredTier.set(t, "COLD");

  const t0 = Date.now();
  const toUnsubscribe: string[] = [];
  const toResolve: string[] = []; // tickers needing chain fetch

  // 1) Drop tickers no longer present.
  for (const ticker of [...state.keys()]) {
    if (!desiredTier.has(ticker)) {
      const st = state.get(ticker)!;
      toUnsubscribe.push(...st.contracts);
      for (const occ of st.contracts) occToTicker.delete(occ);
      state.delete(ticker);
    }
  }

  // 2) Update tiers for existing; mark new tickers for chain resolution.
  for (const [ticker, tier] of desiredTier.entries()) {
    const existing = state.get(ticker);
    if (!existing) {
      state.set(ticker, makeEmptyTickerState(ticker, tier));
      if (tier !== "COLD") toResolve.push(ticker);
      continue;
    }
    if (existing.tier !== tier) {
      existing.tier = tier;
      // If demoted to COLD, drop subs.
      if (tier === "COLD" && existing.contracts.length) {
        toUnsubscribe.push(...existing.contracts);
        for (const occ of existing.contracts) occToTicker.delete(occ);
        existing.contracts = [];
      }
      // If promoted from COLD, contracts is empty → re-resolve.
      if (existing.contracts.length === 0 && tier !== "COLD") {
        toResolve.push(ticker);
      }
    }
  }

  if (toUnsubscribe.length) {
    try { unsubscribeContractsWithQuotes(toUnsubscribe); } catch (err) {
      logger.warn({ err, op: "watcher.setWatchlist.unsubscribe.failed" }, "unsub on demote");
    }
  }

  // 3) Resolve chains for new HOT/WARM tickers — bounded concurrency.
  if (toResolve.length) {
    await resolveAndSubscribeBatch(toResolve);
  }

  logger.info({
    op: "watcher.setWatchlist",
    hot: hot.length, warm: warm.length, cold: cold.length,
    addedTickers: toResolve.length,
    removedSubs: toUnsubscribe.length,
    totalSubscribed: countTotalSubscribed(),
    durationMs: Date.now() - t0,
  }, "watcher.setWatchlist");
}

export function getLiveSessionStats(ticker: string): SessionStats | null {
  const st = state.get(ticker.toUpperCase());
  if (!st) return null;
  return projectStats(st);
}

export function getAllLiveSessionStats(): SessionStats[] {
  return [...state.values()]
    .filter(s => s.tier !== "COLD" || s.events.length > 0)
    .map(projectStats);
}

export function getWatcherStatus(): WatcherStatus {
  let hotCount = 0, warmCount = 0, coldCount = 0, totalSubs = 0;
  let coveredHotWarm = 0, hotWarmCount = 0;
  for (const st of state.values()) {
    if (st.tier === "HOT") hotCount++;
    else if (st.tier === "WARM") warmCount++;
    else coldCount++;
    totalSubs += st.contracts.length;
    if (st.tier !== "COLD") {
      hotWarmCount++;
      if (st.liveEventCount > 0) coveredHotWarm++;
    }
  }
  const coverageRate = hotWarmCount > 0 ? +(coveredHotWarm / hotWarmCount).toFixed(3) : 0;
  return {
    enabled: isWatcherEnabled(),
    running,
    startedAt,
    lastTickTs,
    lastTradeTs,
    hotCount, warmCount, coldCount,
    totalSubscribed: totalSubs,
    budgetCap: TOTAL_SUB_BUDGET,
    coverageRate,
  };
}

// ── Internal: trade handler & projections ───────────────────────────

function handleTrade(t: PolygonOptionTrade): void {
  const ticker = occToTicker.get(t.sym);
  if (!ticker) return;
  const st = state.get(ticker);
  if (!st) return;
  const legSide = st.contractType.get(t.sym);
  const notional = t.price * t.size * 100;

  st.totalPrints++;
  st.lastTradeTs = t.timestamp || Date.now();
  lastTradeTs = st.lastTradeTs;

  if (legSide === "C") st.callNotional += notional;
  else if (legSide === "P") st.putNotional += notional;

  const nbbo = getNbbo(t.sym);
  const chainRow = st.chainByOcc.get(t.sym);
  const oi = chainRow?.openInterest ?? 0;
  const mc = st.marketContext;
  const baselineVol = st.contractBaselineAvgVol20d.get(t.sym);
  const classified = classifyForFlowPersistence({
    price: t.price,
    size: t.size,
    conditions: t.conditions,
    nbbo: nbbo ? { bid: nbbo.bid, ask: nbbo.ask } : null,
    largeNotionalThresholdUsd: mc?.largeNotionalThresholdUsd,
    avgDailyContractVolume20d:
      typeof baselineVol === "number" && baselineVol > 0 ? baselineVol : null,
    openInterest: oi > 0 ? oi : null,
  });
  const { isSweep, isBlockForDb, isLarge, shouldPersist, side: aggressorSide } = classified;
  const meta = parseOccLocal(t.sym);
  const dteDays = meta ? dteCalendarDays(meta.expiration, st.lastTradeTs) : null;
  const sessionPhase = sessionPhaseFromTradeMs(st.lastTradeTs);
  const venueClass = venueClassFromExchangeId(t.exchange);

  if (t.size > st.largestPrintSize) {
    st.largestPrintSize = t.size;
    st.largestPrintNotional = notional;
  }

  if (shouldPersist) {
    st.liveEventCount++;
    st.events.push({
      ts: st.lastTradeTs,
      occ: t.sym,
      size: t.size,
      price: t.price,
      notional,
      kind: isSweep
        ? "sweep"
        : isBlockForDb
          ? "block"
          : classified.volumeSignificant
            ? "volume_spike"
            : "large",
    });
    if (!nbbo) {
      logFlowPipelineWarn(
        "watcher_nbbo_miss",
        "optionsWatcher: NBBO cache miss — aggressor side null",
        { occ: t.sym, ticker },
      );
    } else if (aggressorSide == null) {
      logFlowPipelineWarn(
        "watcher_aggressor",
        "optionsWatcher: aggressor side unavailable (NBBO present)",
        { occ: t.sym, ticker, bid: nbbo.bid, ask: nbbo.ask, price: t.price },
      );
    }
    enqueueClassifiedTrade({
      occ: t.sym,
      ticker,
      ts: st.lastTradeTs,
      price: t.price,
      size: t.size,
      notional,
      isSweep,
      isBlock: isBlockForDb,
      side: aggressorSide,
      exchangeId: t.exchange,
      venueClass,
      dteDays,
      sessionPhase,
      volOiRatio: classified.volOiRatio,
      openInterestSnapshot: oi > 0 ? oi : null,
      volumeVsBaseline20d: classified.volumeVsBaseline20d,
      marketCapUsd: mc?.marketCapUsd ?? null,
      marketCapTier: mc?.tier ?? null,
      notionalThresholdUsd: mc?.largeNotionalThresholdUsd ?? null,
      aggressorConfidence: classified.aggressorConfidence,
    });
    // Cap event log per ticker to keep memory bounded. Mirror TTL-prune
    // behavior so liveEventCount stays consistent with retained events
    // and never inflates coverageRate / LIVE_FLOW inputs in long sessions.
    if (st.events.length > 200) {
      const dropped = st.events.length - 200;
      st.events.splice(0, dropped);
      st.liveEventCount = Math.max(0, st.liveEventCount - dropped);
    }
  }
}

function projectStats(st: PerTickerState): SessionStats {
  // "Directionally balanced" = each side ≥ 35% of total notional and total > 0.
  const total = st.callNotional + st.putNotional;
  let balanced = false;
  if (total > 0) {
    const callShare = st.callNotional / total;
    balanced = callShare >= 0.35 && callShare <= 0.65;
  }
  return {
    ticker: st.ticker,
    tier: st.tier,
    liveEventCount: st.liveEventCount,
    callNotional: Math.round(st.callNotional),
    putNotional: Math.round(st.putNotional),
    directionallyBalanced: balanced,
    largestPrintSize: st.largestPrintSize,
    largestPrintNotional: Math.round(st.largestPrintNotional),
    totalPrints: st.totalPrints,
    contractsSubscribed: st.contracts.length,
    lastTradeTs: st.lastTradeTs || null,
    lastChainRefreshTs: st.lastChainRefreshTs || null,
  };
}

// ── Internal: chain resolution & subscription ───────────────────────

async function resolveAndSubscribeBatch(tickers: string[]): Promise<void> {
  const apiKey = process.env["POLYGON_API_KEY"];
  if (!apiKey) {
    logger.warn({ op: "watcher.resolve.noKey" }, "POLYGON_API_KEY missing — cannot resolve chains");
    return;
  }
  // Bounded concurrency on chain fetches (Polygon-friendly).
  const CONCURRENCY = 4;
  let i = 0;
  await Promise.all(new Array(Math.min(CONCURRENCY, tickers.length)).fill(0).map(async () => {
    while (i < tickers.length) {
      const idx = i++;
      const ticker = tickers[idx]!;
      await resolveAndSubscribeOne(ticker, apiKey);
    }
  }));
}

// Per-ticker in-flight resolve guard so concurrent setWatchlist or
// watcherTick refreshes can never double-resolve the same ticker (which
// would leak occ→ticker entries and inflate WS refcounts).
const resolving = new Set<string>();
// Atomic budget reservation — concurrent resolves (CONCURRENCY=4) all see
// the same `pendingReservation` so two tickers can't simultaneously pass
// the projection check before either's contracts hit shared state.
let pendingReservation = 0;

async function resolveAndSubscribeOne(ticker: string, apiKey: string): Promise<void> {
  const st = state.get(ticker);
  if (!st || st.tier === "COLD") return;
  if (resolving.has(ticker)) {
    logger.debug({ ticker, op: "watcher.resolve.skipInFlight" }, "watcher.resolve already in-flight");
    return;
  }
  resolving.add(ticker);

  // Reserve budget atomically before going async. We over-reserve by
  // `perTicker` (worst case) and release on every exit path below.
  const perTicker = st.tier === "HOT" ? CONTRACTS_PER_HOT : CONTRACTS_PER_WARM;
  const reservation = Math.max(0, perTicker - st.contracts.length);
  const projected = countTotalSubscribed() + pendingReservation + reservation;
  if (projected > TOTAL_SUB_BUDGET) {
    logger.warn({
      op: "watcher.resolve.budgetExceeded",
      ticker, tier: st.tier, projected, cap: TOTAL_SUB_BUDGET,
      pending: pendingReservation,
    }, "watcher.resolve budget cap reached");
    resolving.delete(ticker);
    return;
  }
  pendingReservation += reservation;

  try {
  const t0 = Date.now();
  let chain: Awaited<ReturnType<typeof fetchPolygonChain>> = null;
  try {
    chain = await fetchPolygonChain(ticker, apiKey, { maxDte: 45, maxPages: 4, log: logger });
  } catch (err) {
    logger.warn({ err, ticker, op: "watcher.resolve.fetchChain.failed" }, "watcher.resolve fetchChain");
    return;
  }
  if (!chain || !chain.underlyingPrice) {
    logger.debug({ ticker, op: "watcher.resolve.noChain" }, "watcher.resolve: no chain");
    return;
  }

  // Post-fetch revalidation — setWatchlist could have demoted/removed this
  // ticker while we were awaiting Polygon. Re-read state and abort cleanly
  // (without leaking subs or occToTicker mappings) if ownership changed.
  const stCheck = state.get(ticker);
  if (!stCheck || stCheck !== st || stCheck.tier === "COLD") {
    logger.debug({
      ticker, op: "watcher.resolve.staleAfterFetch",
      removed: !stCheck, demoted: stCheck?.tier === "COLD",
    }, "watcher.resolve: ticker no longer eligible after chain fetch");
    return;
  }

  const candidates = pickCandidates(ticker, chain, perTicker);
  if (!candidates.length) return;

  const symsToAdd = candidates.map(c => c.symbol);

  // Diff old → new contracts. Anything we held that the new chain selection
  // dropped must be unsubscribed (release WS refcount) and dropped from the
  // OCC→ticker map so trades don't get attributed to stale state.
  const newSet = new Set(symsToAdd);
  const toDrop = st.contracts.filter(occ => !newSet.has(occ));
  const oldSet = new Set(st.contracts);
  const trulyNew = symsToAdd.filter(occ => !oldSet.has(occ));

  if (toDrop.length) {
    try { unsubscribeContractsWithQuotes(toDrop); } catch (err) {
      logger.warn({ err, ticker, op: "watcher.resolve.unsubscribe.failed" }, "watcher.resolve unsubscribe drop");
    }
    for (const occ of toDrop) occToTicker.delete(occ);
  }

  st.lastChainRefreshTs = Date.now();
  st.contractType.clear();
  st.chainByOcc.clear();
  st.contractBaselineAvgVol20d.clear();
  for (const c of candidates) st.contractType.set(c.symbol, c.type);
  for (const c of candidates) {
    const list = c.type === "C" ? chain.calls : chain.puts;
    const row = list.find(
      (x) => x.strike === c.strike && x.expiration === c.expiration,
    );
    st.chainByOcc.set(c.symbol, {
      openInterest: row?.openInterest ?? 0,
      volume: row?.volume ?? 0,
    });
  }
  try {
    const baselineMap = await getContracts20dBaselineBatch(symsToAdd);
    for (const occ of symsToAdd) {
      const bl = baselineMap.get(occ);
      if (bl && bl.avgVolume > 0) st.contractBaselineAvgVol20d.set(occ, bl.avgVolume);
    }
  } catch (err) {
    logFlowPipelineWarn(
      "watcher_baseline_batch",
      "optionsWatcher: contract baseline batch failed",
      { err, ticker, occCount: symsToAdd.length },
    );
  }
  st.contracts = symsToAdd;
  for (const occ of symsToAdd) occToTicker.set(occ, ticker);

  if (trulyNew.length) {
    try {
      await subscribeContractsWithQuotes(trulyNew);
    } catch (err) {
      logger.warn({ err, ticker, op: "watcher.resolve.subscribeQuotes.failed" }, "watcher.resolve subscribe T+Q");
      for (const occ of trulyNew) occToTicker.delete(occ);
      st.contracts = st.contracts.filter(occ => !trulyNew.includes(occ));
      return;
    }
  }

  logger.info({
    op: "watcher.resolve.subscribed",
    ticker, tier: st.tier,
    contracts: symsToAdd.length,
    added: trulyNew.length,
    dropped: toDrop.length,
    durationMs: Date.now() - t0,
  }, "watcher.resolve.subscribed");
  void ensureMarketSnapshotForTicker(ticker);
  } finally {
    pendingReservation = Math.max(0, pendingReservation - reservation);
    resolving.delete(ticker);
  }
}

interface Candidate { symbol: string; strike: number; expiration: string; type: "C" | "P"; openInterest: number; volume: number }

function pickCandidates(
  ticker: string,
  chain: { calls: PolygonParsedContract[]; puts: PolygonParsedContract[]; underlyingPrice?: number },
  limit: number,
): Candidate[] {
  const { calls, puts, underlyingPrice } = chain;
  if (!underlyingPrice) return [];
  const expirations = new Set<string>();
  for (const c of calls) if ((c.dte ?? 999) <= 45) expirations.add(c.expiration);
  for (const p of puts) if ((p.dte ?? 999) <= 45) expirations.add(p.expiration);
  const sortedExps = [...expirations].sort();

  const scored: Array<Candidate & { _score: number }> = [];
  for (const list of [calls, puts]) {
    const isCall = list === calls;
    for (const c of list) {
      if (!c.schwabSymbol) continue;
      if ((c.dte ?? 999) > 45) continue;
      const moneyness = Math.abs(c.strike - underlyingPrice) / underlyingPrice;
      if (moneyness > 0.10) continue;
      const expIdx = sortedExps.indexOf(c.expiration);
      const score =
        moneyness * 100 +
        Math.max(0, expIdx) * 2 -
        Math.log10(1 + (c.volume ?? 0)) * 3 -
        Math.log10(1 + (c.openInterest ?? 0)) * 1.5;
      const occ = toPolygonOcc(c.schwabSymbol);
      if (!occ) continue;
      scored.push({
        symbol: occ,
        strike: c.strike,
        expiration: c.expiration,
        type: isCall ? "C" : "P",
        openInterest: c.openInterest ?? 0,
        volume: c.volume ?? 0,
        _score: score,
      });
    }
  }
  scored.sort((a, b) => a._score - b._score);
  return scored.slice(0, limit).map(({ _score: _s, ...rest }) => rest);
}

function toPolygonOcc(schwabSym: string): string | null {
  const collapsed = schwabSym.replace(/\s+/g, "");
  if (!/^[A-Z\.\/]{1,6}\d{6}[CP]\d{8}$/.test(collapsed)) return null;
  return `O:${collapsed}`;
}

// ── Internal: periodic tick ─────────────────────────────────────────

async function watcherTick(): Promise<void> {
  if (!running) return;
  lastTickTs = Date.now();
  const now = lastTickTs;

  // 1) TTL-prune events on every ticker.
  for (const st of state.values()) {
    while (st.events.length && now - st.events[0]!.ts > SESSION_EVENT_TTL_MS) {
      st.events.shift();
      st.liveEventCount = Math.max(0, st.liveEventCount - 1);
    }
  }

  // 2) Refresh stale chains (HOT/WARM only) — skews refreshes across
  // tickers naturally because lastChainRefreshTs is per-ticker.
  const apiKey = process.env["POLYGON_API_KEY"];
  if (apiKey) {
    const stale: string[] = [];
    for (const st of state.values()) {
      if (st.tier === "COLD") continue;
      const age = st.lastChainRefreshTs ? now - st.lastChainRefreshTs : Number.POSITIVE_INFINITY;
      if (age > CHAIN_REFRESH_INTERVAL_MS) stale.push(st.ticker);
    }
    // Cap per tick so we don't burst Polygon.
    if (stale.length) {
      const slice = stale.slice(0, 10);
      await resolveAndSubscribeBatch(slice).catch(err =>
        logFlowPipelineWarn(
          "watcher_tick_refresh",
          "watcher.tick refresh batch failed",
          { err, tickers: slice },
        ),
      );
    }
  }

  logger.debug({
    op: "watcher.tick",
    hot: countByTier("HOT"), warm: countByTier("WARM"), cold: countByTier("COLD"),
    totalSubs: countTotalSubscribed(),
    eventsTotal: sumEvents(),
  }, "watcher.tick");
}

// ── Internal: helpers ────────────────────────────────────────────────

function makeEmptyTickerState(ticker: string, tier: Tier): PerTickerState {
  return {
    ticker, tier, contracts: [],
    callNotional: 0, putNotional: 0,
    liveEventCount: 0,
    largestPrintSize: 0, largestPrintNotional: 0,
    totalPrints: 0, events: [],
    lastTradeTs: 0, lastChainRefreshTs: 0,
    contractType: new Map(),
    chainByOcc: new Map(),
    contractBaselineAvgVol20d: new Map(),
    marketContext: null,
    marketSnapshotFetchedAt: 0,
  };
}

function uniqUpper(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    if (typeof s !== "string") continue;
    const u = s.trim().toUpperCase();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

function countTotalSubscribed(): number {
  let n = 0;
  for (const st of state.values()) n += st.contracts.length;
  return n;
}

function countByTier(tier: Tier): number {
  let n = 0;
  for (const st of state.values()) if (st.tier === tier) n++;
  return n;
}

function sumEvents(): number {
  let n = 0;
  for (const st of state.values()) n += st.liveEventCount;
  return n;
}

async function ensureMarketSnapshotForTicker(ticker: string): Promise<void> {
  const st = state.get(ticker);
  if (!st) return;
  const now = Date.now();
  if (st.marketContext && now - st.marketSnapshotFetchedAt < MARKET_SNAPSHOT_TTL_MS) return;
  const snap = await fetchSchwabMarketSnapshot(ticker);
  const st2 = state.get(ticker);
  if (!st2) return;
  st2.marketContext = buildMarketContextSnapshot({
    ticker,
    marketCapUsd: snap?.marketCapUsd ?? null,
    assetType: snap?.assetType ?? null,
  });
  st2.marketSnapshotFetchedAt = Date.now();
}

// ── Coverage state machine (LIVE / AMBER / EOD) ─────────────────────

export type CoverageState = "LIVE" | "AMBER" | "EOD";

export interface CoverageInfo {
  state: CoverageState;
  reason: string;
  watcherEnabled: boolean;
  running: boolean;
  heartbeatAgeMs: number | null;
  coverageRate: number;
  totalSubscribed: number;
}

export function getCoverageInfo(): CoverageInfo {
  const status = getWatcherStatus();
  const now = Date.now();
  const heartbeatAge = status.lastTradeTs ? now - status.lastTradeTs : null;

  if (!status.enabled) {
    return {
      state: "EOD", reason: "watcher_disabled",
      watcherEnabled: false, running: false,
      heartbeatAgeMs: null, coverageRate: 0,
      totalSubscribed: 0,
    };
  }
  if (!status.running) {
    return {
      state: "EOD", reason: "watcher_not_running",
      watcherEnabled: true, running: false,
      heartbeatAgeMs: null, coverageRate: 0,
      totalSubscribed: 0,
    };
  }
  if (status.totalSubscribed === 0) {
    return {
      state: "EOD", reason: "no_subscriptions",
      watcherEnabled: true, running: true,
      heartbeatAgeMs: heartbeatAge, coverageRate: 0,
      totalSubscribed: 0,
    };
  }

  // LIVE: heartbeat fresh AND coverage ≥ 0.5
  if (heartbeatAge !== null && heartbeatAge < HEARTBEAT_FRESH_MS && status.coverageRate >= 0.5) {
    return {
      state: "LIVE", reason: "fresh_heartbeat_high_coverage",
      watcherEnabled: true, running: true,
      heartbeatAgeMs: heartbeatAge, coverageRate: status.coverageRate,
      totalSubscribed: status.totalSubscribed,
    };
  }
  // EOD: stale > 5 min OR no heartbeat ever
  if (heartbeatAge === null || heartbeatAge > HEARTBEAT_STALE_MS) {
    return {
      state: "EOD",
      reason: heartbeatAge === null ? "no_heartbeat" : "stale_heartbeat",
      watcherEnabled: true, running: true,
      heartbeatAgeMs: heartbeatAge, coverageRate: status.coverageRate,
      totalSubscribed: status.totalSubscribed,
    };
  }
  // AMBER: in-between — running with subs but partial coverage / aging heartbeat.
  return {
    state: "AMBER", reason: "partial_coverage_or_aging_heartbeat",
    watcherEnabled: true, running: true,
    heartbeatAgeMs: heartbeatAge, coverageRate: status.coverageRate,
    totalSubscribed: status.totalSubscribed,
  };
}

// ── Deep-scan (Part 3) helper ────────────────────────────────────────

export interface DeepScanSnapshot {
  ticker: string;
  watched: boolean;
  stats: SessionStats | null;
  recentEvents: Array<{
    ts: number; occ: string; size: number; price: number; notional: number; kind: string;
  }>;
  topContracts: Array<{
    occ: string; type: "C" | "P"; subscribed: boolean;
  }>;
}

export function getDeepScanSnapshot(ticker: string): DeepScanSnapshot {
  const upper = ticker.toUpperCase();
  const st = state.get(upper);
  if (!st) {
    return { ticker: upper, watched: false, stats: null, recentEvents: [], topContracts: [] };
  }
  // Sort events newest-first, cap to 50 for the response.
  const events = [...st.events].sort((a, b) => b.ts - a.ts).slice(0, 50)
    .map(e => ({ ts: e.ts, occ: e.occ, size: e.size, price: e.price, notional: Math.round(e.notional), kind: e.kind }));
  const topContracts = st.contracts.map(occ => ({
    occ,
    type: (st.contractType.get(occ) ?? "C") as "C" | "P",
    subscribed: true,
  }));
  return {
    ticker: upper,
    watched: true,
    stats: projectStats(st),
    recentEvents: events,
    topContracts,
  };
}
