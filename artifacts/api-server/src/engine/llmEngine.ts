/**
 * LLM trading engine — live long-equity execution.
 *
 * Each poll-interval tick, for every configured ticker, this builds the full
 * Features package plus position context, sends it to the model selected in the
 * Auto Trader UI (via the existing `ai` SDK + resolveChatLanguageModel), and
 * parses a strict-JSON decision:
 *   - flat:    {"action":"enter"|"wait","stop":<n>,"thesis":<s>,"reason":<s>}
 *   - holding: {"action":"hold"|"take_profit"|"cut","reason":<s>}
 *
 * "enter"        → entry order (extended-hours LIMIT aware) + resting protective
 *                  STOP at the model's stop, dollar-sized (Max/Trade + Budget).
 * "take_profit" / "cut" → market-sell the position + cancel the resting stop.
 * Anything else (options / non-long-equity) → logged and no-op.
 *
 * Long equity only. Shares the engine `state` singleton so engineStatus(),
 * reconcile, and open-exposure work uniformly with the deterministic engine.
 */
import { generateText } from "ai";
import { resolveChatLanguageModel } from "../lib/chatModel.js";
import { logger } from "../lib/logger.js";
import { broadcastToClients } from "../lib/wsServer.js";
import {
  getStrategistChartEquityBars,
  getQuoteBySymbol,
  addChartEquitySymbols,
  type SchwabChartEquityBarPoint,
} from "../lib/schwabStreamer.js";
import { logAutoTradeDecision } from "../lib/autoTrade/execute.js";
import { getConfig, loadConfig, configExists } from "./config.js";
import { state, etDayKey, toEngineStatus, newSymbolState, openExposure, type SymbolState } from "./state.js";
import { initFeatures, computeFeatures } from "./features.js";
import { canEnter, recordTrade, resetDailyRisk, sizeByDollars } from "./risk.js";
import {
  placeEntryWithStop,
  flattenPosition,
  cancelOrder,
  findWorkingStopOrderId,
} from "./execution.js";
import { buildVolumeProfile } from "./volumeProfile.js";
import { reconcileAccount } from "./reconcile.js";
import { initLogger, logExit, getTodayPnl, getLossStreak } from "./logger.js";
import type { Bar, Config, Features, Signal } from "./types.js";

/** Verbatim system message — see directive item 5. Do not edit. */
const SYSTEM_PROMPT = `You are an intraday equity trader running a live account. Your sole objective is to capture directional price moves, convert them into realized gains, and redeploy capital into the next opportunity. You are not a mean-reversion bot, you do not fade moves, and you do not exist to buy low near an average. You trade in the direction of real momentum and you press advantages when you have them. You manage one long position per symbol at a time.

Each minute you receive the current market state and, if in a trade, your position context. Return one decision as strict JSON.

Core philosophy:
- Winners must run. The largest source of edge is staying in a move that keeps making progress. Do not cut a working trade because price paused, pulled back slightly, or printed one red bar. Moves breathe. Shaking yourself out on noise is how retail accounts bleed.
- Broken theses must be cut decisively. The moment your reason for entering is no longer true — a lower low after higher highs, momentum clearly rolling against you, or the regime flipping — exit. Hesitating on a dead thesis is the other way accounts bleed.
- Take profit when a move is exhausted and you are green. If the push is fading and you are in profit, capture it rather than round-tripping it waiting for more. A booked gain you can redeploy beats an unrealized gain you gave back.
- Apply equal rigor to entering and exiting. Conviction to get in demands conviction to get out. A hair-trigger on exits paired with a high bar on entries guarantees losses. Never trade that way.

Entering:
- Enter only on a real directional edge: momentum with participation (expanding volume / RVOL), a clean push, a structure you can name. "Slightly up on slightly more volume" is not an edge — wait.
- On entry you MUST set a stop price: the level at which your directional thesis is proven wrong. Place it structurally, below the origin of the move, wide enough to survive normal intrabar noise — never a tight scalp stop that noise will clip. Set it where being stopped genuinely means you were wrong.

Managing an open position, each minute choose:
- hold: move intact and progressing; stay in through minor pullbacks.
- take_profit: in profit and the move shows exhaustion or stalling; capture it now.
- cut: thesis broken per the rules above; exit immediately, at a loss if necessary.

You are judged on realized P&L over the session — on capturing real moves and recycling capital — not on trade count and not on being safe. Trade like a disciplined professional with a real edge, not a nervous retail trader who sells every winner early and holds every loser hoping.

Respond ONLY with strict JSON, no other text.
When flat: {"action":"enter"|"wait","stop":<number, required if enter>,"thesis":<short string, required if enter>,"reason":<short string>}
When holding: {"action":"hold"|"take_profit"|"cut","reason":<short string>}`;

// ── Module state ───────────────────────────────────────────────────────────────
let _llmTimer: ReturnType<typeof setInterval> | null = null;
let _llmReconcileTimer: ReturnType<typeof setInterval> | null = null;
let _userId = "";
let _ticking = false;
const RECONCILE_INTERVAL_MS = 15_000;

// ── Decision shape ───────────────────────────────────────────────────────────
type LlmAction = "enter" | "wait" | "hold" | "take_profit" | "cut" | "unsupported";
interface LlmDecision {
  action: LlmAction;
  stop?: number;
  thesis?: string;
  reason: string;
}

// ── Bar / VWAP helpers (shared shape with the deterministic engine) ────────────
function toBar(p: SchwabChartEquityBarPoint, vwap: number): Bar {
  return { timestamp: new Date(p.chartTimeMs), open: p.open, high: p.high, low: p.low, close: p.close, volume: p.volume, vwap };
}
function computeVwap(points: SchwabChartEquityBarPoint[]): number[] {
  let pv = 0, vol = 0;
  return points.map((p) => {
    const typical = (p.high + p.low + p.close) / 3;
    pv += typical * p.volume; vol += p.volume;
    return vol > 0 ? pv / vol : p.close;
  });
}

function etHHMM(): { h: number; m: number } {
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  return { h: et.getHours(), m: et.getMinutes() };
}
function isWeekend(): boolean {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" })).getDay();
  return d === 0 || d === 6;
}
function isTradeWindowOpen(cfg: Config): boolean {
  if (isWeekend()) return false;
  const { h, m } = etHHMM();
  const mins = h * 60 + m;
  if (cfg.enableExtendedHours) return mins >= 7 * 60 && mins < 20 * 60;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

// ── Regime read (trending vs choppy) ───────────────────────────────────────────
function regimeLabel(f: Features): string {
  const trending = (f.trend === "BULLISH" || f.trend === "BEARISH") && Math.abs(f.recentDirection) >= 0.4;
  return trending ? `TRENDING (${f.trend})` : "CHOPPY / RANGE-BOUND";
}

// ── Prompt construction ─────────────────────────────────────────────────────
function marketStateMessage(s: SymbolState, latest: Bar, cfg: Config): string {
  const f = s.features;
  const pos = s.position && !s.position.isFlat ? s.position : null;
  const last = f.last || latest.close;

  const features = [
    `symbol=${s.symbol}`,
    `last=${last.toFixed(2)}`,
    `vwap=${f.vwap.toFixed(2)} (dist ${f.vwapDist >= 0 ? "+" : ""}${f.vwapDist.toFixed(2)})`,
    `ema50=${f.ema50.toFixed(2)} ema200=${f.ema200.toFixed(2)} trend=${f.trend}`,
    `rsi=${f.rsi.toFixed(1)}`,
    `atr=${f.atr.toFixed(3)}`,
    `volRatio=${f.volRatio.toFixed(2)} rvol=${f.rvol.toFixed(2)}`,
    `recentDirection=${f.recentDirection.toFixed(2)}`,
    `dayHigh=${f.dayHigh.toFixed(2)} dayLow=${f.dayLow.toFixed(2)} rangePos=${(f.rangePos * 100).toFixed(0)}%`,
    `bar(o=${latest.open.toFixed(2)},h=${latest.high.toFixed(2)},l=${latest.low.toFixed(2)},c=${latest.close.toFixed(2)})`,
    `spreadBps=${f.spreadBps.toFixed(1)}`,
    `minutesSinceOpen=${f.minutesSinceOpen}`,
    `regime=${regimeLabel(f)}`,
  ].join("\n");

  let position = "FLAT (no open position)";
  if (pos) {
    const unreal = (last - pos.avgPrice) * pos.quantity;
    const heldMin = pos.entryAt ? Math.round((Date.now() - pos.entryAt) / 60000) : 0;
    const distStop = last - pos.stopPrice;
    const runPct = ((last - pos.avgPrice) / pos.avgPrice) * 100;
    const hwm = pos.highWaterMark ?? last;
    const stillHH = latest.high >= hwm - 1e-9;
    position = [
      `LONG ${pos.quantity} @ ${pos.avgPrice.toFixed(2)}`,
      `unrealizedPnl=$${unreal.toFixed(2)} (${runPct >= 0 ? "+" : ""}${runPct.toFixed(2)}%)`,
      `minutesHeld=${heldMin}`,
      `stop=${pos.stopPrice.toFixed(2)} (distance ${distStop >= 0 ? "+" : ""}${distStop.toFixed(2)})`,
      `highWaterMark=${hwm.toFixed(2)} runFromEntry=${(hwm - pos.avgPrice).toFixed(2)}`,
      `stillMakingHigherHighs=${stillHH ? "yes" : "no"}`,
      `thesis=${pos.thesis ?? "(none)"}`,
    ].join(" | ");
  }

  const budgetRoom = Math.max(0, cfg.totalBudget - openExposure());
  return [
    "MARKET STATE:",
    features,
    "",
    `POSITION: ${position}`,
    `BUDGET REMAINING: $${budgetRoom.toFixed(0)} | MAX PER TRADE: $${cfg.maxPerTrade.toFixed(0)}`,
    "",
    "Decide now. Respond with strict JSON only.",
  ].join("\n");
}

function parseLlmDecision(raw: string, hasPosition: boolean): LlmDecision {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { action: hasPosition ? "hold" : "wait", reason: "unparseable model output" };
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const a = typeof obj.action === "string" ? obj.action.toLowerCase().trim() : "";
    const reason = typeof obj.reason === "string" ? obj.reason.slice(0, 400) : "(no reason)";
    if (!hasPosition) {
      if (a === "enter") {
        const stop = typeof obj.stop === "number" ? obj.stop : Number(obj.stop);
        const thesis = typeof obj.thesis === "string" ? obj.thesis.slice(0, 300) : "";
        return { action: "enter", stop: Number.isFinite(stop) ? stop : undefined, thesis, reason };
      }
      if (a === "wait") return { action: "wait", reason };
      // Anything else while flat (e.g. an options action) is unsupported here.
      return { action: a === "hold" ? "wait" : "unsupported", reason: reason || `unsupported action "${a}"` };
    }
    if (a === "hold") return { action: "hold", reason };
    if (a === "take_profit") return { action: "take_profit", reason };
    if (a === "cut") return { action: "cut", reason };
    return { action: "unsupported", reason: reason || `unsupported action "${a}"` };
  } catch {
    return { action: hasPosition ? "hold" : "wait", reason: "JSON parse error" };
  }
}

async function askModel(cfg: Config, userMsg: string): Promise<string> {
  const resolved = resolveChatLanguageModel(cfg.modelId, { extendedThinkingEnabled: false });
  const callOpts: Record<string, unknown> =
    "providerOptions" in resolved
      ? { providerOptions: resolved.providerOptions }
      : { temperature: (resolved as { temperature?: number }).temperature };
  const { text } = await generateText({
    model: resolved.model,
    system: SYSTEM_PROMPT,
    prompt: userMsg,
    ...callOpts,
  } as Parameters<typeof generateText>[0]);
  return text;
}

// ── Per-symbol processing ─────────────────────────────────────────────────────
async function processSymbolLlm(s: SymbolState, cfg: Config): Promise<void> {
  const rawPoints = getStrategistChartEquityBars(s.symbol);
  if (!rawPoints.length) return;
  const vwaps = computeVwap(rawPoints);
  const bars: Bar[] = rawPoints.map((p, i) => toBar(p, vwaps[i]!));
  s.sessionBars = bars;
  const latest = bars[bars.length - 1]!;
  s.lastBarAt = latest.timestamp;

  const q = getQuoteBySymbol(s.symbol);
  computeFeatures(bars, s.features, cfg, q ? { bid: q.bid, ask: q.ask, last: q.last, high: q.high, low: q.low } : null, s.volumeProfile);
  const f = s.features;
  const last = f.last || latest.close;
  const hasPosition = !!(s.position && !s.position.isFlat);

  let decision: LlmDecision;
  try {
    decision = parseLlmDecision(await askModel(cfg, marketStateMessage(s, latest, cfg)), hasPosition);
  } catch (err) {
    logger.error({ err, symbol: s.symbol }, "[llm] model call failed");
    decision = { action: hasPosition ? "hold" : "wait", reason: "model call failed" };
  }

  // ── Holding ──
  if (hasPosition) {
    const pos = s.position!;
    if (decision.action === "hold") {
      await persist(s.symbol, "HOLD", decision.reason, null, false, cfg);
      return;
    }
    if (decision.action === "take_profit" || decision.action === "cut") {
      const ok = await flattenPosition(pos.symbol, pos.quantity, cfg);
      // Cancel the resting protective stop so it can't fire on the now-flat name.
      const stopId = pos.stopOrderId ?? (await findWorkingStopOrderId(pos.symbol, cfg));
      if (stopId) await cancelOrder(stopId, cfg);
      if (ok) {
        const pnl = (last - pos.avgPrice) * pos.quantity;
        try {
          logExit({
            entryOrderId: s.pendingEntryOrderId ?? "llm",
            exitOrderId: decision.action,
            symbol: pos.symbol,
            entryPrice: pos.avgPrice,
            exitPrice: last,
            quantity: pos.quantity,
            pnl,
            exitReason: decision.action === "cut" ? "KILL_SWITCH" : "TARGET_HIT",
            exitAt: new Date(),
          });
        } catch { /* non-fatal */ }
        recordTrade(state.riskState, pos.symbol, pnl, cfg);
        s.position = null;
        s.pendingEntryOrderId = null;
        s.pendingEntryAt = null;
        s.pendingSignal = null;
      }
      await persist(s.symbol, decision.action.toUpperCase(), decision.reason, null, ok, cfg);
      return;
    }
    // Unsupported action while holding → no-op (defensive).
    await persist(s.symbol, "NOOP", decision.reason, null, false, cfg);
    return;
  }

  // ── Flat ──
  if (decision.action === "wait") {
    await persist(s.symbol, "WAIT", decision.reason, null, false, cfg);
    return;
  }
  if (decision.action === "unsupported") {
    // Options / non-long-equity action — log and no-op (not executed in this build).
    await persist(s.symbol, "NOOP", `unsupported (options/non-equity): ${decision.reason}`, null, false, cfg);
    return;
  }
  if (decision.action !== "enter") return;

  // enter — require a valid model stop below the entry.
  const entry = last;
  const stop = decision.stop;
  if (!stop || !(stop > 0) || stop >= entry) {
    await persist(s.symbol, "WAIT", `enter rejected — invalid/absent stop (${decision.reason})`, null, false, cfg);
    return;
  }
  const size = sizeByDollars(entry, cfg, openExposure());
  const signal: Signal = {
    timestamp: latest.timestamp, symbol: s.symbol, action: "BUY",
    entryPrice: entry, stopPrice: stop, targetPrice: 0, size,
    confidence: 1, reason: decision.thesis || decision.reason,
  };
  const [ok, blockReason] = canEnter(signal, state.riskState, state.account, s.position, cfg, openExposure());
  if (!ok) {
    await persist(s.symbol, "WAIT", `blocked: ${blockReason}`, null, false, cfg);
    return;
  }

  const result = await placeEntryWithStop(s.symbol, size, entry, stop, cfg);
  if (result.ok) {
    s.position = {
      symbol: s.symbol, quantity: size, avgPrice: entry, stopPrice: stop, targetPrice: 0,
      isFlat: false, highWaterMark: latest.high, entryAt: Date.now(), stopOrderId: null,
      thesis: decision.thesis || decision.reason,
    };
    s.pendingSignal = signal;
    if (result.entryOrderId) {
      s.pendingEntryOrderId = result.entryOrderId;
      s.pendingEntryAt = Date.now();
      void reconcileAccount(cfg);
    }
  }
  await persist(s.symbol, "ENTER", decision.thesis || decision.reason, result.entryOrderId, result.ok, cfg, result.error);
}

async function persist(
  ticker: string, decision: string, reasoning: string,
  orderId: string | null, placed: boolean, cfg: Config, error?: string,
): Promise<void> {
  await logAutoTradeDecision({
    userId: _userId, ticker, decision, reasoning,
    modelId: cfg.modelId, schwabOrderId: orderId, placed, error: error ?? null,
  });
}

function broadcast(): void {
  let setup: Config["setup"] = "swing";
  try { setup = getConfig().setup; } catch { /* not loaded */ }
  broadcastToClients("engineStatus", { ...toEngineStatus(), setup });
}

async function llmTick(): Promise<void> {
  if (!state.running || _ticking) return;
  _ticking = true;
  try {
    const today = etDayKey();
    if (state.dayKey !== today) {
      state.dayKey = today;
      for (const s of state.symbols.values()) { s.position = null; s.pendingEntryOrderId = null; s.pendingSignal = null; }
      resetDailyRisk(state.riskState);
    }
    let cfg: Config;
    try { cfg = getConfig(); } catch { return; }
    if (!isTradeWindowOpen(cfg)) { broadcast(); return; }

    state.riskState.dailyLossHalt = getTodayPnl() <= -cfg.dailyMaxLoss;
    state.riskState.lossStreak = getLossStreak();

    for (const s of state.symbols.values()) {
      try { await processSymbolLlm(s, cfg); }
      catch (err) { logger.error({ err, symbol: s.symbol }, "[llm] processSymbol failed"); }
    }
    broadcast();
  } finally {
    _ticking = false;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
export function startLlmEngine(userId: string): void {
  if (state.running) { logger.warn("[llm] engine already running"); return; }
  if (!configExists()) throw new Error("config.yaml not found — cannot start LLM engine");
  const cfg = loadConfig();
  if (!cfg.symbols.length) throw new Error("config.yaml: at least one symbol is required");
  initLogger(cfg.logDb);

  _userId = userId;
  state.symbols.clear();
  for (const sym of cfg.symbols) state.symbols.set(sym, newSymbolState(sym));
  state.running = true;
  state.activeEngine = "llm";
  state.startedAt = new Date();
  state.dayKey = etDayKey();

  addChartEquitySymbols(cfg.symbols);
  for (const sym of cfg.symbols) {
    void buildVolumeProfile(sym, cfg.volumeProfileLookbackDays).then((p) => {
      const s = state.symbols.get(sym); if (s) s.volumeProfile = p;
    });
  }

  logger.info({ symbols: cfg.symbols, model: cfg.modelId, pollSec: cfg.pollIntervalSec }, "[llm] engine started (live)");
  _llmTimer = setInterval(() => void llmTick(), Math.max(5, cfg.pollIntervalSec) * 1000);
  _llmReconcileTimer = setInterval(() => {
    try { void reconcileAccount(getConfig()); } catch { /* config not loaded */ }
  }, RECONCILE_INTERVAL_MS);
  void llmTick();
  broadcast();
}

export function stopLlmEngine(): void {
  if (_llmTimer) { clearInterval(_llmTimer); _llmTimer = null; }
  if (_llmReconcileTimer) { clearInterval(_llmReconcileTimer); _llmReconcileTimer = null; }
  if (state.activeEngine === "llm") { state.running = false; state.activeEngine = null; }
  logger.info("[llm] engine stopped");
  broadcast();
}
