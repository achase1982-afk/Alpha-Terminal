/**
 * Swing Engine — continuous intraday hot loop.
 *
 * Runs on a setInterval tick (default 60 s). Each tick, for EVERY configured
 * symbol independently:
 *  1. Convert in-memory Schwab bars → engine Bar[] (cumulative VWAP baked in)
 *  2. Recompute the full feature set (bar shape, VWAP rails, RVOL vs the
 *     historical volume profile, RSI/EMA/ATR, day-range position, spread)
 *  3. Cancel-timeout: drop an unfilled entry limit and roll back its position
 *  4. Manage the open position: the broker's OCO bracket exits for real and
 *     reconcileAccount() syncs engine state to broker truth
 *  5. If flat: evaluate the active setup (swing by default) → risk guards →
 *     place a live Schwab bracket order
 *  6. Log the evaluation and broadcast status to the React dashboard via WS
 *
 * Holds at most one position per symbol at a time; re-enters continuously
 * through the session. Time-stop flattens everything near the close.
 */
import { getConfig, loadConfig, configExists } from "./config.js";
import { state, etDayKey, toEngineStatus, newSymbolState, openExposure, type SymbolState } from "./state.js";
import { initFeatures, computeFeatures } from "./features.js";
import { checkSetup } from "./setups/orb.js";
import { checkSwingSetup } from "./setups/swing.js";
import { canEnter, recordTrade, resetDailyRisk, sizeByDollars } from "./risk.js";
import { placeBracket, placeEntryWithStop, replaceTrailStop, flattenPosition, cancelOrder } from "./execution.js";
import { initLogger, logSignal, logExit, logEvaluation, getTodayPnl, getLossStreak } from "./logger.js";
import { logger } from "../lib/logger.js";
import { broadcastToClients } from "../lib/wsServer.js";
import {
  getStrategistChartEquityBars,
  getQuoteBySymbol,
  addChartEquitySymbols,
  type SchwabChartEquityBarPoint,
} from "../lib/schwabStreamer.js";
import { buildVolumeProfile } from "./volumeProfile.js";
import { reconcileAccount } from "./reconcile.js";
import { logEngineDecision } from "./decisionLog.js";
import type { Bar, Signal, Config, ExitReason } from "./types.js";

// ── Module-private timers ────────────────────────────────────────────────────
let _barTimer: ReturnType<typeof setInterval> | null = null;
let _timeStopTimer: ReturnType<typeof setInterval> | null = null;
let _reconcileTimer: ReturnType<typeof setInterval> | null = null;

/** Broker reconciliation cadence. */
const RECONCILE_INTERVAL_MS = 15_000;
/** Flatten-at-close time when the toggle is on (10 min before the 16:00 close). */
const FLATTEN_AT_CLOSE_ET = "15:50";

// ── Bar conversion ────────────────────────────────────────────────────────────

function toBar(point: SchwabChartEquityBarPoint, vwap: number): Bar {
  return {
    timestamp: new Date(point.chartTimeMs),
    open: point.open,
    high: point.high,
    low: point.low,
    close: point.close,
    volume: point.volume,
    vwap,
  };
}

/** Cumulative VWAP from raw bar points (pure). */
function computeVwap(points: SchwabChartEquityBarPoint[]): number[] {
  let pv = 0;
  let vol = 0;
  return points.map((p) => {
    const typical = (p.high + p.low + p.close) / 3;
    pv += typical * p.volume;
    vol += p.volume;
    return vol > 0 ? pv / vol : p.close;
  });
}

// ── ET time helpers ───────────────────────────────────────────────────────────

function etHHMM(): { h: number; m: number } {
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  return { h: et.getHours(), m: et.getMinutes() };
}

function isWeekend(): boolean {
  const day = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" })).getDay();
  return day === 0 || day === 6;
}

function isPastTimeStop(timeStop: string): boolean {
  const [sh, sm] = timeStop.split(":").map(Number);
  const { h, m } = etHHMM();
  return h * 60 + m >= (sh ?? 16) * 60 + (sm ?? 0);
}

/**
 * Whether the engine should evaluate now. Regular hours 9:30–16:00 ET, or
 * 7:00–20:00 ET when extended hours is enabled. Replaces the old fixed-RTH check.
 */
function isTradeWindowOpen(cfg: Config): boolean {
  if (isWeekend()) return false;
  const { h, m } = etHHMM();
  const mins = h * 60 + m;
  if (cfg.enableExtendedHours) return mins >= 7 * 60 && mins < 20 * 60;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

// ── Day boundary reset ──────────────────────────────────────────────────────

function maybeResetDay(): void {
  const today = etDayKey();
  if (state.dayKey === today) return;

  logger.info({ was: state.dayKey, now: today }, "[engine] day boundary — resetting state");
  state.dayKey = today;
  for (const s of state.symbols.values()) {
    s.sessionBars = [];
    s.features = initFeatures();
    s.position = null;
    s.pendingEntryOrderId = null;
    s.pendingEntryAt = null;
    s.pendingSignal = null;
  }
  resetDailyRisk(state.riskState);
}

// ── Cancel-timeout: drop an unfilled entry limit and roll back its position ───

async function checkCancelTimeout(s: SymbolState, cfg: Config): Promise<void> {
  if (!s.pendingEntryOrderId || !s.pendingEntryAt) return;
  const elapsed = (Date.now() - s.pendingEntryAt) / 1000;
  if (elapsed < cfg.cancelTimeoutSeconds) return;

  logger.info({ symbol: s.symbol, orderId: s.pendingEntryOrderId, elapsed }, "[engine] entry timeout — cancelling");
  await cancelOrder(s.pendingEntryOrderId, cfg);
  s.pendingEntryOrderId = null;
  s.pendingEntryAt = null;
  s.pendingSignal = null;
  // The entry never filled — clear the optimistic position so it isn't flattened
  // later and so the strategy can re-arm for the next signal.
  s.position = null;
}

// ── Exit management: detect target/stop touches, record the exit + P&L ────────

function recordExit(s: SymbolState, exitPrice: number, reason: ExitReason, cfg: Config): void {
  const pos = s.position;
  if (!pos) return;
  const pnl = (exitPrice - pos.avgPrice) * pos.quantity; // long-only

  try {
    logExit({
      entryOrderId: s.pendingEntryOrderId ?? "unknown",
      exitOrderId: reason === "TIME_STOP" ? "time-stop" : "bracket-oco",
      symbol: pos.symbol,
      entryPrice: pos.avgPrice,
      exitPrice,
      quantity: pos.quantity,
      pnl,
      exitReason: reason,
      exitAt: new Date(),
    });
  } catch (err) {
    logger.warn({ err, symbol: s.symbol }, "[engine] logExit failed");
  }

  recordTrade(state.riskState, pos.symbol, pnl, cfg);
  logger.info({ symbol: pos.symbol, exitPrice, pnl: pnl.toFixed(2), reason }, "[engine] position closed");

  logEngineDecision({
    ticker: pos.symbol,
    decision: reason === "TIME_STOP" ? "FLATTEN_CLOSE" : "EXIT",
    reasoning: reason === "TIME_STOP" ? "3:55 PM ET time-stop flatten" : `exit (${reason})`,
    quantity: pos.quantity,
    exitPrice: Math.round(exitPrice * 1e4) / 1e4,
    pnl: Math.round(pnl * 1e4) / 1e4,
  });

  s.position = null;
  s.pendingEntryOrderId = null;
  s.pendingEntryAt = null;
  s.pendingSignal = null;
}

// ── Time-stop: flatten everything at/after cfg.timeStop ───────────────────────

async function checkTimeStop(): Promise<void> {
  if (!state.running) return;
  let cfg: Config;
  try {
    cfg = getConfig();
  } catch {
    return;
  }
  // Flatten at 15:50 ET when "Flatten at Close" is on; otherwise at cfg.timeStop.
  const flattenAt = cfg.flattenAtClose ? FLATTEN_AT_CLOSE_ET : cfg.timeStop;
  if (!isPastTimeStop(flattenAt)) return;

  for (const s of state.symbols.values()) {
    if (!s.position || s.position.isFlat) continue;
    logger.warn({ symbol: s.symbol }, "[engine] time stop — flattening");
    await flattenPosition(s.position.symbol, s.position.quantity, cfg);
    const exitPrice = s.features.last || s.position.avgPrice;
    recordExit(s, exitPrice, "TIME_STOP", cfg);
  }
  broadcastEngine();
}

// ── Broadcast ─────────────────────────────────────────────────────────────────

function broadcastEngine(): void {
  let setup: Config["setup"] = "swing";
  try {
    setup = getConfig().setup;
  } catch {
    /* config not loaded yet */
  }
  broadcastToClients("engineStatus", { ...toEngineStatus(), setup });
}

// ── Per-symbol processing ─────────────────────────────────────────────────────

async function processSymbol(s: SymbolState, cfg: Config): Promise<void> {
  // 1. Cancel-timeout on any unfilled live entry.
  await checkCancelTimeout(s, cfg);

  // 2. Bars from the in-memory streamer.
  const rawPoints = getStrategistChartEquityBars(s.symbol);
  if (!rawPoints.length) return;

  const vwaps = computeVwap(rawPoints);
  const bars: Bar[] = rawPoints.map((p, i) => toBar(p, vwaps[i]!));
  s.sessionBars = bars;
  const latest = bars[bars.length - 1]!;
  s.lastBarAt = latest.timestamp;

  // 3. Features.
  const q = getQuoteBySymbol(s.symbol);
  computeFeatures(
    bars,
    s.features,
    cfg,
    q ? { bid: q.bid, ask: q.ask, last: q.last, high: q.high, low: q.low } : null,
    s.volumeProfile,
  );
  const f = s.features;

  // 4. Manage an open position.
  if (s.position && !s.position.isFlat) {
    // Momentum: trail the protective stop upward each tick (raise-only). The
    // resting broker STOP is the executor; reconcile records the exit on fill.
    // ORB: the OCO bracket manages the exit at the broker.
    if (cfg.setup === "swing") await manageTrailingStop(s, latest, bars, cfg);
    logEvaluation({ symbol: s.symbol, action: "HOLD", reason: "position open", last: f.last, vwap: f.vwap, lowerRail: f.lowerRail, rsi: f.rsi, volRatio: f.volRatio });
    return;
  }
  if (s.pendingEntryOrderId) return; // awaiting fill / cancel-timeout

  // 5. Evaluate the active setup.
  const signal: Signal | null =
    cfg.setup === "orb"
      ? checkSetup(latest, f, cfg, s.symbol)
      : checkSwingSetup(latest, f, cfg, s.symbol, bars);

  if (!signal) {
    logEvaluation({ symbol: s.symbol, action: "FLAT", reason: "no setup", last: f.last, vwap: f.vwap, lowerRail: f.lowerRail, rsi: f.rsi, volRatio: f.volRatio });
    return;
  }

  // Authoritative dollar sizing against live open exposure (Max/Trade + Budget).
  signal.size = sizeByDollars(signal.entryPrice, cfg, openExposure());

  const [ok, reason] = canEnter(signal, state.riskState, state.account, s.position, cfg, openExposure());
  logEvaluation({ symbol: s.symbol, action: ok ? "ENTER" : "BLOCK", reason: ok ? signal.reason : reason, last: f.last, vwap: f.vwap, lowerRail: f.lowerRail, rsi: f.rsi, volRatio: f.volRatio });

  if (!ok) {
    broadcastToClients("engineSignal", { signal, blocked: true, blockReason: reason });
    return;
  }

  logger.info(
    { symbol: signal.symbol, entry: signal.entryPrice, stop: signal.stopPrice, size: signal.size, setup: cfg.setup },
    "[engine:live] signal — placing entry",
  );
  logSignal(signal);

  // Momentum (swing): entry + resting protective STOP, trailed each tick.
  // ORB (legacy): entry + OCO (target + stop).
  const result =
    cfg.setup === "orb"
      ? await placeBracket(signal, cfg)
      : await placeEntryWithStop(signal.symbol, signal.size, signal.entryPrice, signal.stopPrice, cfg);

  if (result.ok) {
    s.position = {
      symbol: signal.symbol,
      quantity: signal.size,
      avgPrice: signal.entryPrice,
      stopPrice: signal.stopPrice,
      targetPrice: signal.targetPrice,
      isFlat: false,
      highWaterMark: latest.high,
      entryAt: Date.now(),
      stopOrderId: null,
      thesis: signal.reason,
    };
    s.pendingSignal = signal;
    logEngineDecision({
      ticker: signal.symbol,
      decision: "ENTER",
      reasoning: signal.reason,
      quantity: signal.size,
      notional: Math.round(signal.entryPrice * signal.size * 1e4) / 1e4,
      orderId: result.entryOrderId,
      placed: true,
    });
    if (result.entryOrderId) {
      s.pendingEntryOrderId = result.entryOrderId;
      s.pendingEntryAt = Date.now();
      // Reconcile shortly after placing a live order so a quick reject/fill is
      // caught against the broker rather than assumed (on-order-event trigger).
      void reconcileAccount(cfg);
    }
  } else {
    logger.error({ error: result.error, symbol: signal.symbol }, "[engine] entry placement failed");
  }
  broadcastToClients("engineSignal", { signal, blocked: false, blockReason: "" });
}

/**
 * Trailing-stop management (momentum). On each new higher high, raise the stop
 * to trail behind price — the higher of a recent swing low and (high − trail×ATR)
 * — and never lower it. The resting broker STOP is replaced to the new level.
 */
async function manageTrailingStop(s: SymbolState, latest: Bar, bars: Bar[], cfg: Config): Promise<void> {
  const pos = s.position;
  if (!pos || pos.isFlat || pos.quantity < 1) return;
  if (!(latest.high > 0) || !(s.features.atr > 0)) return;

  const prevHwm = pos.highWaterMark ?? pos.avgPrice;
  // Only trail when price prints a new higher high.
  if (latest.high <= prevHwm) return;
  pos.highWaterMark = latest.high;

  const recentLow = Math.min(...bars.slice(-3).map((b) => b.low)); // most-recent higher-low proxy
  const atrTrail = pos.highWaterMark - cfg.momTrailAtrMult * s.features.atr;
  const candidate = Math.max(recentLow, atrTrail);

  const last = s.features.last || latest.close;
  // Raise-only, and keep the stop below the current price.
  if (candidate <= pos.stopPrice || candidate >= last) return;

  const newStopOrderId = await replaceTrailStop(pos.symbol, pos.quantity, candidate, pos.stopOrderId ?? null, cfg);
  pos.stopPrice = candidate;
  pos.stopOrderId = newStopOrderId;
}

// ── Main tick ─────────────────────────────────────────────────────────────────

async function onTick(): Promise<void> {
  if (!state.running) return;
  maybeResetDay();

  const cfg = getConfig();

  if (!isTradeWindowOpen(cfg)) {
    broadcastEngine();
    return;
  }

  // Account-wide daily-loss halt (dollar-based), refreshed each tick.
  const todayPnl = getTodayPnl();
  state.riskState.dailyLossHalt = todayPnl <= -cfg.dailyMaxLoss;
  state.riskState.lossStreak = getLossStreak();

  for (const s of state.symbols.values()) {
    try {
      await processSymbol(s, cfg);
    } catch (err) {
      logger.error({ err, symbol: s.symbol }, "[engine] processSymbol failed");
    }
  }

  broadcastEngine();
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startEngine(userId = ""): void {
  if (state.running) {
    logger.warn("[engine] already running");
    return;
  }
  if (!configExists()) {
    throw new Error("config.yaml not found at repo root — create it before starting the engine");
  }

  const cfg = loadConfig();
  initLogger(cfg.logDb);

  if (!cfg.symbols.length) {
    throw new Error("config.yaml: at least one symbol is required before starting the engine");
  }

  // Build per-symbol state.
  state.symbols.clear();
  for (const sym of cfg.symbols) state.symbols.set(sym, newSymbolState(sym));

  state.running = true;
  state.activeEngine = "deterministic";
  state.userId = userId;
  state.startedAt = new Date();
  state.dayKey = etDayKey();

  // Subscribe the Schwab streamer to every symbol.
  addChartEquitySymbols(cfg.symbols);

  // Build historical volume profiles in the background (non-blocking).
  for (const sym of cfg.symbols) {
    void buildVolumeProfile(sym, cfg.volumeProfileLookbackDays).then((profile) => {
      const s = state.symbols.get(sym);
      if (s) s.volumeProfile = profile;
    });
  }

  logger.info({ symbols: cfg.symbols, setup: cfg.setup, pollSec: cfg.pollIntervalSec }, "[engine] started (live, deterministic momentum)");

  _barTimer = setInterval(() => void onTick(), Math.max(5, cfg.pollIntervalSec) * 1000);
  _timeStopTimer = setInterval(() => void checkTimeStop(), 10_000);

  // Keep engine state pinned to broker truth on a short interval.
  _reconcileTimer = setInterval(() => {
    try {
      void reconcileAccount(getConfig());
    } catch {
      /* config not loaded — skip this cycle */
    }
  }, RECONCILE_INTERVAL_MS);

  // Fire immediately so the dashboard shows state right away.
  void onTick();

  broadcastEngine();
}

export function stopEngine(): void {
  if (_barTimer) { clearInterval(_barTimer); _barTimer = null; }
  if (_timeStopTimer) { clearInterval(_timeStopTimer); _timeStopTimer = null; }
  if (_reconcileTimer) { clearInterval(_reconcileTimer); _reconcileTimer = null; }
  state.running = false;
  if (state.activeEngine === "deterministic") state.activeEngine = null;
  logger.info("[engine] stopped");
  broadcastEngine();
}

export function engineStatus() {
  let setup: Config["setup"] = "swing";
  try {
    if (configExists()) setup = getConfig().setup;
  } catch {
    /* config.yaml exists but loadConfig() not yet called */
  }
  return { ...toEngineStatus(), setup };
}

// Exported for tests.
export { checkCancelTimeout, processSymbol };
