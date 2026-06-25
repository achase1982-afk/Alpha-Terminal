/**
 * ORB Engine — hot loop.
 *
 * Runs on a setInterval tick (default 60 s). Each tick:
 *  1. Convert in-memory Schwab bars → engine Bar[]
 *  2. Update features (OR, RVOL, ATR, VWAP, spread)
 *  3. Check strategy signal (setups/orb.ts)
 *  4. Run risk guards
 *  5. Place bracket order (shadow or live)
 *  6. Broadcast status to React dashboard via WS
 *
 * Time-stop checker runs on its own 10-second interval.
 * Day-boundary reset happens at the first tick of a new ET calendar date.
 */
import { getConfig, loadConfig, configExists } from "./config.js";
import { state, etDayKey, toEngineStatus } from "./state.js";
import {
  initFeatures,
  updateSession,
  updateOpeningRange,
  updateATR,
  setRvolFromAvgVolume,
} from "./features.js";
import { checkSetup } from "./setups/orb.js";
import { canEnter, recordTrade, resetDailyRisk } from "./risk.js";
import { placeBracket, flattenPosition } from "./execution.js";
import { initLogger, logSignal, getTodayPnl, getLossStreak } from "./logger.js";
import { logger } from "../lib/logger.js";
import { broadcastToClients } from "../lib/wsServer.js";
import {
  getStrategistChartEquityBars,
  getQuoteBySymbol,
  addChartEquitySymbols,
  type SchwabChartEquityBarPoint,
} from "../lib/schwabStreamer.js";
import type { Bar } from "./types.js";

// ── Module-private timers ────────────────────────────────────────────────────
let _barTimer: ReturnType<typeof setInterval> | null = null;
let _timeStopTimer: ReturnType<typeof setInterval> | null = null;

// ── Bar conversion ────────────────────────────────────────────────────────────

function toBar(point: SchwabChartEquityBarPoint, vwap: number): Bar {
  return {
    timestamp: new Date(point.chartTimeMs),
    open:   point.open,
    high:   point.high,
    low:    point.low,
    close:  point.close,
    volume: point.volume,
    vwap,
  };
}

/** Compute cumulative VWAP from raw bar points (pure, no side-effects). */
function computeVwap(points: SchwabChartEquityBarPoint[]): number[] {
  let pv = 0;
  let vol = 0;
  return points.map((p) => {
    const typical = (p.high + p.low + p.close) / 3;
    pv  += typical * p.volume;
    vol += p.volume;
    return vol > 0 ? pv / vol : p.close;
  });
}

// ── Day boundary reset ────────────────────────────────────────────────────────

function maybeResetDay(): void {
  const today = etDayKey();
  if (state.dayKey === today) return;

  logger.info({ was: state.dayKey, now: today }, "[engine] day boundary — resetting state");
  state.dayKey        = today;
  state.sessionBars   = [];
  state.vwapAccum     = { pv: 0, vol: 0 };
  state.features      = initFeatures();
  state.position      = null;
  state.enteredToday  = false;
  state.pendingEntryOrderId = null;
  state.pendingEntryAt      = null;
  resetDailyRisk(state.riskState);
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
  return h * 60 + m >= sh * 60 + sm;
}

function isMarketOpen(): boolean {
  const { h, m } = etHHMM();
  const mins = h * 60 + m;
  return !isWeekend() && mins >= 9 * 60 + 30 && mins < 16 * 60;
}

// ── Cancel-timeout: cancel entry limit if unfilled after N seconds ────────────

/** Exported for tests. */
export async function checkCancelTimeout(): Promise<void> {
  const cfg = getConfig();
  if (!state.pendingEntryOrderId || !state.pendingEntryAt) return;
  const elapsed = (Date.now() - state.pendingEntryAt) / 1000;
  if (elapsed < cfg.cancelTimeoutSeconds) return;

  logger.info(
    { orderId: state.pendingEntryOrderId, elapsed },
    "[engine] entry order timeout — cancelling",
  );
  const { cancelOrder } = await import("./execution.js");
  await cancelOrder(state.pendingEntryOrderId, cfg);
  state.pendingEntryOrderId = null;
  state.pendingEntryAt      = null;

  // The entry limit never filled, so the position we optimistically recorded
  // when placing the bracket never actually opened. Roll that state back:
  //  - clear the phantom position so the 15:55 time-stop doesn't fire a SELL
  //    MARKET for shares we never bought (an accidental short in live mode);
  //  - re-arm the strategy so it can take the next valid signal — no trade
  //    occurred, so this entry should not lock out the rest of the day.
  state.position     = null;
  state.enteredToday = false;
  broadcastEngine();
}

// ── Time-stop: flatten at 15:55 ET ───────────────────────────────────────────

async function checkTimeStop(): Promise<void> {
  const cfg = getConfig();
  if (!isPastTimeStop(cfg.timeStop)) return;
  if (!state.position || state.position.isFlat) return;

  logger.warn({ symbol: state.symbol }, "[engine] time stop — flattening position");
  await flattenPosition(state.position.symbol, state.position.quantity, cfg);
  state.position = { ...state.position, isFlat: true };
  broadcastEngine();
}

// ── Broadcast ─────────────────────────────────────────────────────────────────

function broadcastEngine(): void {
  const status = toEngineStatus();
  const payload = { ...status, runMode: getConfig().runMode };
  broadcastToClients("engineStatus", payload);
}

// ── Main bar tick ─────────────────────────────────────────────────────────────

async function onTick(): Promise<void> {
  if (!state.running) return;

  maybeResetDay();

  const cfg = getConfig();

  if (isWeekend() || !isMarketOpen()) {
    broadcastEngine();
    return;
  }

  await checkCancelTimeout();

  // ── 1. Fetch bars from in-memory streamer ────────────────────────────────
  const rawPoints = getStrategistChartEquityBars(state.symbol);
  if (!rawPoints.length) {
    logger.debug({ symbol: state.symbol }, "[engine] no bars yet");
    return;
  }

  const vwaps = computeVwap(rawPoints);
  const bars: Bar[] = rawPoints.map((p, i) => toBar(p, vwaps[i]!));

  // Update session bar list (replace fully — streamer already dedupes)
  state.sessionBars = bars;
  state.lastBarAt   = bars[bars.length - 1]!.timestamp;

  // ── 2. Update features ───────────────────────────────────────────────────
  const quote = getQuoteBySymbol(state.symbol);
  const bid   = quote?.bid   ?? null;
  const ask   = quote?.ask   ?? null;
  const last  = quote?.last  ?? bars[bars.length - 1]!.close;

  updateSession(bars[bars.length - 1]!, state.features, bid, ask);
  updateOpeningRange(bars, state.features, cfg);
  updateATR(bars, state.features);

  // RVOL: use a rough avg from the quote's volume × session fraction
  // (A precise per-minute volume profile requires historical DB queries — see buildVolumeProfile())
  const sessionVol = bars.reduce((s, b) => s + b.volume, 0);
  const elapsed    = Math.max(1, bars.length);
  // Approximate avg daily volume from today's pace (only useful after 30+ min)
  if (elapsed >= 30) {
    const impliedDaily = (sessionVol / elapsed) * 390;
    setRvolFromAvgVolume(bars, state.features, impliedDaily);
  }

  // ── 3. Daily loss guard ──────────────────────────────────────────────────
  const todayPnl = getTodayPnl();
  const haltThresh = -(cfg.startingEquity * cfg.dailyLossHaltPct);
  state.riskState.dailyLossHalt = todayPnl <= haltThresh;
  state.riskState.lossStreak    = getLossStreak();
  state.riskState.tradesToday   = 0; // recounted from DB below if needed

  // ── 4. Check signal ──────────────────────────────────────────────────────
  if (!state.enteredToday && state.features.orComplete) {
    const latestBar = bars[bars.length - 1]!;
    const signal = checkSetup(latestBar, state.features, cfg);

    if (signal) {
      const [ok, reason] = canEnter(signal, state.riskState, state.account, state.position, cfg);

      if (ok) {
        logger.info(
          { symbol: signal.symbol, entry: signal.entryPrice, stop: signal.stopPrice, target: signal.targetPrice, size: signal.size, rvol: state.features.rvol },
          `[engine:${cfg.runMode}] signal — placing bracket`,
        );
        logSignal(signal);

        const result = await placeBracket(signal, cfg);
        if (result.ok) {
          state.enteredToday = true;
          state.position = {
            symbol:      signal.symbol,
            quantity:    signal.size,
            avgPrice:    signal.entryPrice,
            stopPrice:   signal.stopPrice,
            targetPrice: signal.targetPrice,
            isFlat:      false,
          };
          if (result.entryOrderId) {
            state.pendingEntryOrderId = result.entryOrderId;
            state.pendingEntryAt      = Date.now();
          }
        } else {
          logger.error({ error: result.error }, "[engine] bracket placement failed");
        }
      } else {
        logger.info({ reason, symbol: signal.symbol }, "[engine] signal blocked by risk");
      }
      broadcastToClients("engineSignal", { signal, blocked: !ok, blockReason: "" });
    }
  }

  state.features.vwap = last; // keep dashboard VWAP current
  broadcastEngine();
}

// ── Public API ────────────────────────────────────────────────────────────────

export function startEngine(): void {
  if (state.running) {
    logger.warn("[engine] already running");
    return;
  }
  if (!configExists()) {
    throw new Error("config.yaml not found at repo root — create it before starting the engine");
  }

  const cfg = loadConfig();
  initLogger(cfg.logDb);

  if (!cfg.symbol) {
    throw new Error("config.yaml: symbol is required before starting the engine");
  }

  state.symbol    = cfg.symbol;
  state.running   = true;
  state.startedAt = new Date();
  state.dayKey    = etDayKey();

  // Subscribe the Schwab streamer to this symbol
  addChartEquitySymbols([cfg.symbol]);

  logger.info({ symbol: cfg.symbol, runMode: cfg.runMode }, "[engine] started");

  _barTimer      = setInterval(() => void onTick(), 60_000);
  _timeStopTimer = setInterval(() => void checkTimeStop(), 10_000);

  // Fire immediately so the dashboard shows state right away
  void onTick();

  broadcastToClients("engineStatus", { running: true, symbol: cfg.symbol, runMode: cfg.runMode });
}

export function stopEngine(): void {
  if (_barTimer)      { clearInterval(_barTimer);      _barTimer      = null; }
  if (_timeStopTimer) { clearInterval(_timeStopTimer); _timeStopTimer = null; }
  state.running = false;
  logger.info("[engine] stopped");
  broadcastToClients("engineStatus", { running: false });
}

export function engineStatus() {
  const status = toEngineStatus();
  let runMode = "shadow";
  try {
    if (configExists()) runMode = getConfig().runMode;
  } catch {
    // config.yaml exists but loadConfig() not yet called — defaults to shadow
  }
  return { ...status, runMode };
}
