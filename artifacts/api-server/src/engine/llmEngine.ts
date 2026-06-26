/**
 * LLM trading engine — live LONG-equity execution (no broker-side stop).
 *
 * Each poll-interval tick, for every configured ticker, this builds a complete
 * decision payload (live price + entry/position + the full Features package),
 * sends it to the model selected in the Auto Trader UI (via the existing `ai`
 * SDK), and parses a strict-JSON decision:
 *   - flat:    {"action":"enter"|"wait","thesis":<s>,"reason":<s>}
 *   - holding: {"action":"hold"|"take_profit","reason":<s>}
 *
 * Hard rules enforced in CODE (not just the prompt):
 *   - No protective stop is ever placed (a resting stop reserves the shares and
 *     causes the later market-sell exit to be rejected). Entry order only.
 *   - A tick missing any required live price field is skipped and logged — the
 *     model is never asked to trade blind.
 *   - A sell at/below entry price is rejected and the position holds. The only
 *     exception is Flatten-at-Close (3:50 PM ET), which sells regardless.
 *   - Before any exit, reconcile confirms the position exists at the broker;
 *     if not, that symbol's loop is halted instead of re-firing every tick.
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
  type LiveQuote,
} from "../lib/schwabStreamer.js";
import { logAutoTradeDecision } from "../lib/autoTrade/execute.js";
import { getConfig, loadConfig, configExists } from "./config.js";
import { state, etDayKey, toEngineStatus, newSymbolState, openExposure, type SymbolState } from "./state.js";
import { computeFeatures } from "./features.js";
import { recordTrade, resetDailyRisk, sizeByDollars } from "./risk.js";
import { placeEntry, flattenPosition } from "./execution.js";
import { buildVolumeProfile } from "./volumeProfile.js";
import { reconcileAccount } from "./reconcile.js";
import { initLogger, logExit, getTodayPnl, getLossStreak } from "./logger.js";
import type { Bar, Config, Features } from "./types.js";

/** Verbatim system message (long-only, never-sell-below-entry, never-trade-blind). */
const SYSTEM_PROMPT = `You are an intraday equity trader running a live account. You trade long stock only. You are NOT a short seller — you never sell to open, you only sell to close a long you already hold. Your objective is to capture upward price moves, realize the gain, and redeploy into the next opportunity. You manage one long position per symbol at a time.

ABSOLUTE RULES — these are not judgment calls:
1. You must know the price to act. Every decision requires the current price (last) and, when you hold a position, your entry price. If either is missing from the data you were given, your only allowed action is "wait" (when flat) or "hold" (when in a position). Never place or exit a trade without knowing price. If you cannot see price, you do not trade.
2. You never sell below your entry price. If you hold a position and the current price is at or below your entry, your only allowed action is "hold." You do not panic-sell a position that is underwater. A pullback is not a reason to exit. You exit a winner, never bail a loser — the position is closed at end of day if it never recovers, but you do not sell it at a loss intraday.
3. You only take profit above entry. "take_profit" is permitted only when current price is above your entry price AND the upward move looks exhausted or stalling. Capture the gain then.

How to read the data you are given each tick:
- entryPrice is what you paid; compare current last to it constantly. unrealizedPnlPct tells you if you are green or red right now.
- Use vwap, rsi, ema50/ema200, trend, rvol, volRatio, atr to judge momentum and exhaustion. Strength with participation (rising price, volume confirming, price holding above vwap) means hold a winner. Momentum rolling over while you are green means take profit.
- Use the ET time and minutesSinceOpen for context; the open is noisy.

Entering (when flat):
- Enter only on a real upward directional edge: momentum with volume participation (rvol and volRatio elevated), price pushing up and holding above vwap, a clean move you can name. "Slightly up on slightly more volume" is not an edge — wait.
- Do not fade. Do not buy a falling knife hoping it bounces. You buy strength, not weakness.

Managing a position:
- hold: default. Hold through minor pullbacks. Hold whenever price is at or below entry. Hold while the move is still progressing.
- take_profit: only when price is above entry and the move is exhausted/stalling.

You are judged on realized P&L — capturing real upward moves and recycling capital. You are not judged on trade count. Do not behave like a nervous retail trader who buys and then sells the moment it ticks down. That behavior is forbidden by the rules above.

Respond ONLY with strict JSON, no other text.
When flat: {"action":"enter"|"wait","thesis":<string if enter>,"reason":<string>}
When holding: {"action":"hold"|"take_profit","reason":<string>}`;

// ── Module state ───────────────────────────────────────────────────────────────
let _llmTimer: ReturnType<typeof setInterval> | null = null;
let _llmReconcileTimer: ReturnType<typeof setInterval> | null = null;
let _userId = "";
let _ticking = false;
const RECONCILE_INTERVAL_MS = 15_000;
/** Symbols whose loop is halted (e.g. position not found at broker). Cleared at start/day. */
const haltedSymbols = new Set<string>();

type LlmAction = "enter" | "wait" | "hold" | "take_profit" | "unsupported";
interface LlmDecision { action: LlmAction; thesis?: string; reason: string }

// ── Bar / VWAP helpers ────────────────────────────────────────────────────────
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

function etNow(): { h: number; m: number; label: string } {
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const h = et.getHours(), m = et.getMinutes();
  return { h, m, label: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} ET` };
}
function isWeekend(): boolean {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" })).getDay();
  return d === 0 || d === 6;
}
function isTradeWindowOpen(cfg: Config): boolean {
  if (isWeekend()) return false;
  const { h, m } = etNow();
  const mins = h * 60 + m;
  if (cfg.enableExtendedHours) return mins >= 7 * 60 && mins < 20 * 60;
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}
/** 3:50 PM ET flatten-at-close gate. */
function isPastFlattenClose(): boolean {
  const { h, m } = etNow();
  return h * 60 + m >= 15 * 60 + 50;
}

function regimeLabel(f: Features): string {
  const trending = (f.trend === "BULLISH" || f.trend === "BEARISH") && Math.abs(f.recentDirection) >= 0.4;
  return trending ? `TRENDING (${f.trend})` : "CHOPPY";
}

// ── Decision payload (item 2) ───────────────────────────────────────────────
interface BuiltPayload { json: string; last: number }

/**
 * Build the complete decision payload. Returns null when any required live
 * price field is missing — the caller then skips the tick (never trades blind).
 */
function buildDecisionPayload(s: SymbolState, latest: Bar, bars: Bar[], cfg: Config, quote: LiveQuote | undefined): BuiltPayload | null {
  const f = s.features;
  const sessionOpen = bars[0]?.open ?? null;
  if (!quote) return null;

  const last = quote.last;
  const bid = quote.bid;
  const ask = quote.ask;
  const dayHigh = quote.high;
  const dayLow = quote.low;
  const priorClose = quote.close; // Schwab field 12 = previous day's close

  // Required live price fields — any missing → skip the tick.
  if (
    last == null || !Number.isFinite(last) ||
    bid == null || ask == null ||
    dayHigh == null || dayLow == null ||
    priorClose == null || sessionOpen == null
  ) return null;

  const spread = ask - bid;
  const sessionChange = quote.change ?? (last - priorClose);
  const sessionChangePct = quote.changePct ?? (priorClose ? ((last - priorClose) / priorClose) * 100 : 0);
  const { label: etTime } = etNow();

  const pos = s.position && !s.position.isFlat ? s.position : null;
  let position: Record<string, unknown> | "FLAT" = "FLAT";
  if (pos) {
    const entryPrice = pos.avgPrice; // broker-reconciled actual average fill
    const unrealizedPnl = (last - entryPrice) * pos.quantity;
    const unrealizedPnlPct = entryPrice ? ((last - entryPrice) / entryPrice) * 100 : 0;
    position = {
      entryPrice: round(entryPrice),
      currentQty: pos.quantity,
      minutesHeld: pos.entryAt ? Math.round((Date.now() - pos.entryAt) / 60000) : 0,
      unrealizedPnl: round(unrealizedPnl),
      unrealizedPnlPct: round(unrealizedPnlPct),
    };
  }

  const payload = {
    symbol: s.symbol,
    session: { etTime, minutesSinceOpen: f.minutesSinceOpen },
    price: {
      last: round(last), bid: round(bid), ask: round(ask), spread: round(spread),
      sessionChange: round(sessionChange), sessionChangePct: round(sessionChangePct),
      dayHigh: round(dayHigh), dayLow: round(dayLow), open: round(sessionOpen), priorClose: round(priorClose),
    },
    indicators: {
      vwap: round(f.vwap), vwapDist: round(f.vwapDist), atr: round(f.atr), rsi: round(f.rsi),
      ema50: round(f.ema50), ema200: round(f.ema200), trend: f.trend, regime: regimeLabel(f),
      rvol: round(f.rvol), volRatio: round(f.volRatio),
      lowerRail: round(f.lowerRail), upperRail: round(f.upperRail), rangePos: round(f.rangePos),
    },
    position,
    budget: { remaining: round(Math.max(0, cfg.totalBudget - openExposure())), maxPerTrade: cfg.maxPerTrade },
  };
  return { json: JSON.stringify(payload), last };
}

function round(n: number): number { return Math.round(n * 1e4) / 1e4; }

function parseLlmDecision(raw: string, hasPosition: boolean): LlmDecision {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { action: hasPosition ? "hold" : "wait", reason: "unparseable model output" };
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>;
    const a = typeof obj.action === "string" ? obj.action.toLowerCase().trim() : "";
    const reason = typeof obj.reason === "string" ? obj.reason.slice(0, 400) : "(no reason)";
    if (hasPosition) {
      if (a === "take_profit") return { action: "take_profit", reason };
      if (a === "hold") return { action: "hold", reason };
      return { action: "hold", reason: reason || `coerced "${a}" → hold` }; // any sell/option/unknown → hold
    }
    if (a === "enter") {
      const thesis = typeof obj.thesis === "string" ? obj.thesis.slice(0, 300) : "";
      return { action: "enter", thesis, reason };
    }
    if (a === "wait") return { action: "wait", reason };
    return { action: "wait", reason: reason || `unsupported "${a}" → wait` };
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
    model: resolved.model, system: SYSTEM_PROMPT, prompt: userMsg, ...callOpts,
  } as Parameters<typeof generateText>[0]);
  return text;
}

// ── Per-symbol processing ─────────────────────────────────────────────────────
async function processSymbolLlm(s: SymbolState, cfg: Config): Promise<void> {
  if (haltedSymbols.has(s.symbol)) return; // halted until manual restart

  const rawPoints = getStrategistChartEquityBars(s.symbol);
  if (!rawPoints.length) { logger.info({ symbol: s.symbol }, "[llm] skipped: incomplete data (no bars)"); return; }
  const vwaps = computeVwap(rawPoints);
  const bars: Bar[] = rawPoints.map((p, i) => toBar(p, vwaps[i]!));
  s.sessionBars = bars;
  const latest = bars[bars.length - 1]!;
  s.lastBarAt = latest.timestamp;

  const quote = getQuoteBySymbol(s.symbol);
  computeFeatures(bars, s.features, cfg, quote ? { bid: quote.bid, ask: quote.ask, last: quote.last, high: quote.high, low: quote.low } : null, s.volumeProfile);

  // Build the full payload; skip the tick if any required price field is missing.
  const built = buildDecisionPayload(s, latest, bars, cfg, quote);
  if (!built) { logger.warn({ symbol: s.symbol }, "[llm] skipped: incomplete data (missing price field)"); return; }
  const last = built.last;
  const hasPosition = !!(s.position && !s.position.isFlat);

  let decision: LlmDecision;
  try {
    decision = parseLlmDecision(await askModel(cfg, built.json), hasPosition);
  } catch (err) {
    logger.error({ err, symbol: s.symbol }, "[llm] model call failed");
    decision = { action: hasPosition ? "hold" : "wait", reason: "model call failed" };
  }

  // ── Holding ──
  if (hasPosition) {
    const pos = s.position!;
    if (decision.action !== "take_profit") {
      await persist(s.symbol, "HOLD", decision.reason, null, false, cfg);
      return;
    }
    // CODE-ENFORCED: never sell at or below entry (only Flatten-at-Close may).
    if (last <= pos.avgPrice) {
      await persist(s.symbol, "HOLD", `take_profit blocked — last ${last.toFixed(2)} ≤ entry ${pos.avgPrice.toFixed(2)}`, null, false, cfg);
      return;
    }
    // RECONCILE GUARD: confirm the position still exists at the broker.
    await reconcileAccount(cfg);
    const p2 = s.position;
    if (!p2 || p2.isFlat || p2.quantity < 1) {
      haltedSymbols.add(s.symbol);
      await persist(s.symbol, "HALT", "position not found at broker — symbol loop halted", null, false, cfg);
      logger.warn({ symbol: s.symbol }, "[llm] position absent at broker — halting symbol");
      return;
    }
    const ok = await flattenPosition(p2.symbol, p2.quantity, cfg);
    if (ok) recordExit(s, p2.avgPrice, p2.quantity, last, "TARGET_HIT", cfg);
    await persist(s.symbol, "TAKE_PROFIT", decision.reason, null, ok, cfg);
    return;
  }

  // ── Flat ──
  if (decision.action !== "enter") {
    await persist(s.symbol, "WAIT", decision.reason, null, false, cfg);
    return;
  }

  // Inline long-entry guards (no stop in this build, so canEnter's stop checks don't apply).
  const block = entryBlockReason(cfg);
  if (block) { await persist(s.symbol, "WAIT", `blocked: ${block}`, null, false, cfg); return; }
  const entry = last;
  const size = sizeByDollars(entry, cfg, openExposure());
  if (size < 1) { await persist(s.symbol, "WAIT", "blocked: budget full / size < 1", null, false, cfg); return; }

  const result = await placeEntry(s.symbol, size, entry, cfg);
  if (result.ok) {
    s.position = {
      symbol: s.symbol, quantity: size, avgPrice: entry, stopPrice: 0, targetPrice: 0,
      isFlat: false, highWaterMark: latest.high, entryAt: Date.now(), stopOrderId: null,
      thesis: decision.thesis || decision.reason,
    };
    s.pendingSignal = null;
    if (result.entryOrderId) {
      s.pendingEntryOrderId = result.entryOrderId;
      s.pendingEntryAt = Date.now();
      void reconcileAccount(cfg); // pull the actual average fill into pos.avgPrice
    }
  }
  await persist(s.symbol, "ENTER", decision.thesis || decision.reason, result.entryOrderId, result.ok, cfg, result.error);
}

/** Non-stop entry guards (halts, cooldown, trade cap, daily loss). */
function entryBlockReason(cfg: Config): string | null {
  const r = state.riskState;
  if (r.halted) return r.haltReason ?? "halted";
  if (r.dailyLossHalt) return "daily max loss halt";
  if (r.cooldownUntil && new Date() < r.cooldownUntil) return "cooldown";
  if (r.tradesToday >= cfg.tradesPerDay) return `max ${cfg.tradesPerDay} trades/day`;
  if (r.lossStreak >= cfg.lossStreakLimit) return `loss streak ${r.lossStreak}/${cfg.lossStreakLimit}`;
  return null;
}

function recordExit(s: SymbolState, entryPrice: number, qty: number, exitPrice: number, reason: "TARGET_HIT" | "TIME_STOP", cfg: Config): void {
  const pnl = (exitPrice - entryPrice) * qty;
  try {
    logExit({
      entryOrderId: s.pendingEntryOrderId ?? "llm", exitOrderId: reason === "TIME_STOP" ? "flatten-close" : "take-profit",
      symbol: s.symbol, entryPrice, exitPrice, quantity: qty, pnl, exitReason: reason, exitAt: new Date(),
    });
  } catch { /* non-fatal */ }
  recordTrade(state.riskState, s.symbol, pnl, cfg);
  s.position = null;
  s.pendingEntryOrderId = null;
  s.pendingEntryAt = null;
  s.pendingSignal = null;
}

/** Flatten-at-close: market-sell every open position regardless of P&L (the one below-entry exception). */
async function flattenAllAtClose(cfg: Config): Promise<void> {
  for (const s of state.symbols.values()) {
    const pos = s.position;
    if (!pos || pos.isFlat || pos.quantity < 1) continue;
    const ok = await flattenPosition(pos.symbol, pos.quantity, cfg);
    const last = s.features.last || pos.avgPrice;
    if (ok) {
      recordExit(s, pos.avgPrice, pos.quantity, last, "TIME_STOP", cfg);
      await persist(s.symbol, "FLATTEN_CLOSE", "3:50 PM ET flatten-at-close", null, true, cfg);
    }
  }
}

async function persist(ticker: string, decision: string, reasoning: string, orderId: string | null, placed: boolean, cfg: Config, error?: string): Promise<void> {
  await logAutoTradeDecision({ userId: _userId, ticker, decision, reasoning, modelId: cfg.modelId, schwabOrderId: orderId, placed, error: error ?? null });
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
      haltedSymbols.clear();
      for (const s of state.symbols.values()) { s.position = null; s.pendingEntryOrderId = null; s.pendingSignal = null; }
      resetDailyRisk(state.riskState);
    }
    let cfg: Config;
    try { cfg = getConfig(); } catch { return; }

    // Flatten-at-close takes priority and bypasses the below-entry guard.
    if (cfg.flattenAtClose && !isWeekend() && isPastFlattenClose()) {
      await flattenAllAtClose(cfg);
      broadcast();
      return;
    }
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
  haltedSymbols.clear();
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

  logger.info({ symbols: cfg.symbols, model: cfg.modelId, pollSec: cfg.pollIntervalSec }, "[llm] engine started (live, no stop)");
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
