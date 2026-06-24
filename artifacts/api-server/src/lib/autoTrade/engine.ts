import { getTokens } from "../tokenStore.js";
import { logger } from "../logger.js";
import { broadcastToClients } from "../wsServer.js";
import { fetchMappedSchwabAccounts } from "../schwabPortfolioAccounts.js";
import { getAutoTradeConfig, setAutoTradeRunning, type AutoTradeConfig } from "./config.js";
import { buildAutoTradeSnapshot, type AutoTradeSnapshot } from "./snapshot.js";
import { decideAutoTrade, type AutoTradeDecision } from "./decision.js";
import { placeAutoEquityOrder, placeAutoEquityOrderWithTrailingStop, logAutoTradeDecision, journalAutoEntry } from "./execute.js";
import { recordTradeExit, generateAndStorePlaybook, getStoredPlaybook, getAutoTradeRealizedPnlToday } from "./outcomes.js";
import { addSymbols, addChartEquitySymbols } from "../schwabStreamer.js";

// ── Exit rule constants ─────────────────────────────────────────────────────
// Research basis: for high-beta volatile stocks (MARA, TQQQ, SQQQ, RIVN),
// normal intraday noise exceeds 0.75%. ATR-based stops at 2x ATR typically
// land 2–5% from entry — wide enough to survive noise, tight enough to matter.
const TRAIL_ATR_MULTIPLIER = 2.0; // 2x the 5-min ATR14 → stop distance
const MIN_STOP_PCT = 0.01;        // 1% floor — even calm stocks need some room
const MAX_STOP_PCT = 0.05;        // 5% ceiling — cap drawdown per trade
const TIME_STOP_MS = 5 * 60_000; // 5 min held with no profit → exit (matches 1-min chart cadence)

// Fast position monitor — software trailing stop replaces the Schwab TRIGGER order
// (which is rejected on this account type). Runs every 5 sec, fully independent
// of the 60-second LLM cycle. No LLM call — pure math.
const POSITION_MONITOR_INTERVAL_MS = 5_000;

interface TrailingStopPosition {
  shares: number;
  entryPrice: number;
}

interface OpenPosition {
  shares: number;
  entryPrice: number;
  entryTime: number;
  /** ATR-derived stop distance, locked at entry: 2× (ATR14/price), clamped 1–5%. */
  stopPct: number;
  /** Take-profit target locked at entry: 1.5× stopPct. Positive R:R scalping exit. */
  profitTargetPct: number;
  /** High-water mark — ratchets up only, never down. Software trailing stop reference. */
  hwm: number;
  /** Guards against double-sell when the monitor and the LLM cycle fire simultaneously. */
  exitPending: boolean;
}

interface RunnerState {
  busy: boolean;
  stopRequested: boolean;
  /**
   * Current open exposure in dollars — increments on BUY, decrements on exit.
   * Compared against config.totalBudget to gate new entries.
   * Resets to 0 at the ET day boundary (no overnight positions in a scalper).
   */
  deployedToday: number;
  dayKey: string;
  timer: NodeJS.Timeout | null;
  /** Fast position monitor timer — runs every 5 s, independent of the LLM cycle. */
  monitorTimer: NodeJS.Timeout | null;
  lastCycleAt: number;
  /** Tickers currently managed by a trailing stop order — LLM decisions are skipped for these. */
  activeTrailingStops: Map<string, TrailingStopPosition>;
  /** In-memory position book — entry price, time, ATR stop, and HWM for each open trade. */
  openPositions: Map<string, OpenPosition>;
  /** Stored from the last successful cycle — lets the monitor place orders without a config round-trip. */
  lastAccountHash: string | null;
  lastModelId: string;
}

const runners = new Map<string, RunnerState>();

function todayKey(): string {
  return new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" });
}

/**
 * Returns true when trading is permitted for the current session.
 * - enableExtendedHours = true:  7:00 AM – 8:00 PM ET (pre-market + regular + after-hours)
 * - enableExtendedHours = false: 9:30 AM – 4:00 PM ET (regular hours only, default)
 *
 * Extended-hours orders automatically use Schwab LIMIT session "AM"/"PM" via
 * currentSchwabSession() in the execute layer. Liquidity is lower in extended
 * hours; the LLM prompt raises the conviction bar for entries during those windows.
 */
function isTradingHours(config: AutoTradeConfig): boolean {
  const et = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = et.getHours() * 60 + et.getMinutes();
  if (config.enableExtendedHours) {
    return minutes >= 7 * 60 && minutes < 20 * 60; // 7 AM – 8 PM ET
  }
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60; // 9:30 AM – 4:00 PM ET only
}

interface AccountView {
  hashValue: string | null;
  dayPL: number;
  positions: Array<{
    symbol: string;
    underlyingSymbol: string;
    assetType: string;
    longQuantity: number;
    shortQuantity: number;
  }>;
}

async function loadAccount(config: AutoTradeConfig): Promise<AccountView | null> {
  const token = getTokens("trader")?.accessToken;
  if (!token) return null;
  try {
    const accounts = (await fetchMappedSchwabAccounts(token)) as unknown as AccountView[];
    if (!accounts.length) return null;
    if (config.accountHash) {
      return accounts.find((a) => a.hashValue === config.accountHash) ?? null;
    }
    return accounts[0] ?? null;
  } catch (err) {
    logger.warn({ err }, "autoTrade loadAccount failed");
    return null;
  }
}

function longSharesFor(account: AccountView, symbol: string): number {
  const sym = symbol.toUpperCase();
  let qty = 0;
  for (const p of account.positions) {
    if (p.assetType === "EQUITY" && p.symbol.toUpperCase() === sym) {
      qty += p.longQuantity;
    }
  }
  return qty;
}

/** Compute ATR-based stop % for a new position, locked at entry time. */
function computeStopPct(atr14: number | null, price: number): number {
  if (!atr14 || atr14 <= 0 || price <= 0) return 0.02; // 2% fallback if no ATR yet
  const raw = (atr14 / price) * TRAIL_ATR_MULTIPLIER;
  return Math.min(MAX_STOP_PCT, Math.max(MIN_STOP_PCT, raw));
}

type TickerResult =
  | { kind: "skip" }
  | { kind: "trailing_stop_hit"; ticker: string; snapshot: AutoTradeSnapshot; pos: TrailingStopPosition }
  | { kind: "trailing_active" }
  | { kind: "rule_exit"; ticker: string; last: number; heldShares: number; reason: "stop_loss" | "trailing_stop" | "time_stop" | "profit_target" }
  | { kind: "decision"; ticker: string; snapshot: AutoTradeSnapshot; last: number; heldShares: number; decision: AutoTradeDecision };

/**
 * Fast position monitor — runs every 5 seconds, completely independent of the
 * 60-second LLM cycle. Replicates the Schwab TRIGGER+TRAILING_STOP order in
 * software since that order type is rejected on this account.
 *
 * Algorithm: track a high-water mark (HWM) since entry. The HWM only ever
 * ratchets upward. When price drops stopPct% below the HWM (or below entry if
 * the trade never moved up), fire a market SELL immediately.
 */
async function runPositionMonitor(userId: string, state: RunnerState): Promise<void> {
  if (state.openPositions.size === 0) return;
  if (state.stopRequested) return;
  const accountHash = state.lastAccountHash;
  if (!accountHash) return;

  for (const [ticker, pos] of state.openPositions) {
    if (pos.exitPending) continue;

    const snapshot = buildAutoTradeSnapshot(ticker);
    if (!snapshot.tradeable || snapshot.last == null) continue;

    const last = snapshot.last;

    // Ratchet HWM — only moves up, captures the highest price seen since entry.
    if (last > pos.hwm) pos.hwm = last;

    // Profit target — exit when price reaches entry × (1 + profitTargetPct).
    const profitTargetPct = pos.profitTargetPct ?? pos.stopPct * 1.5;
    const profitPrice = pos.entryPrice * (1 + profitTargetPct);
    if (last >= profitPrice) {
      pos.exitPending = true;
      const orderResult = await placeAutoEquityOrder(accountHash, ticker, "SELL", pos.shares, last);
      if (orderResult.ok) {
        state.deployedToday = Math.max(0, state.deployedToday - pos.shares * last);
        state.openPositions.delete(ticker);
        void recordTradeExit(userId, ticker, last, pos.shares);
      } else {
        pos.exitPending = false;
      }
      void logAutoTradeDecision({
        userId,
        ticker,
        decision: "RULE_PROFIT_TARGET",
        instrument: "stock",
        quantity: pos.shares,
        reasoning: `Profit target (${(profitTargetPct * 100).toFixed(1)}%): $${last.toFixed(2)} reached target $${profitPrice.toFixed(2)} (entry $${pos.entryPrice.toFixed(2)})`,
        modelId: state.lastModelId,
        schwabOrderId: orderResult.orderId,
        placed: orderResult.ok,
        error: orderResult.error ?? null,
      });
      broadcastToClients("orderAlert", {
        type: "RULE_PROFIT_TARGET",
        symbol: ticker,
        side: "SELL",
        quantity: String(pos.shares),
        orderId: orderResult.orderId,
        status: orderResult.ok ? "PLACED" : "FAILED",
        timestamp: Date.now(),
        raw: "position-monitor",
      });
      logger.info(
        { userId, ticker, last, profitPrice, shares: pos.shares, placed: orderResult.ok },
        "autoTrade monitor: profit target triggered",
      );
      continue;
    }

    // Two-layer stop — higher price wins (more protective once in profit):
    // - Trailing: follow the HWM down by stopPct (locks in gains)
    // - Hard:     fixed floor at entry - stopPct (prevents blow-up on immediate reversal)
    const trailStopPrice = pos.hwm * (1 - pos.stopPct);
    const hardStopPrice  = pos.entryPrice * (1 - pos.stopPct);
    const stopPrice = Math.max(trailStopPrice, hardStopPrice);

    if (last <= stopPrice) {
      pos.exitPending = true;
      const reason = last <= hardStopPrice ? "stop_loss" : "trailing_stop";
      const orderResult = await placeAutoEquityOrder(accountHash, ticker, "SELL", pos.shares, last);
      if (orderResult.ok) {
        state.deployedToday = Math.max(0, state.deployedToday - pos.shares * last);
        state.openPositions.delete(ticker);
        void recordTradeExit(userId, ticker, last, pos.shares);
      } else {
        pos.exitPending = false; // allow retry on the next 5-second tick
      }
      void logAutoTradeDecision({
        userId,
        ticker,
        decision: reason === "stop_loss" ? "RULE_STOP_LOSS" : "RULE_TRAILING_STOP",
        instrument: "stock",
        quantity: pos.shares,
        reasoning: reason === "stop_loss"
          ? `Hard stop (${(pos.stopPct * 100).toFixed(1)}% ATR): $${last.toFixed(2)} below entry floor $${hardStopPrice.toFixed(2)}`
          : `Trailing stop (${(pos.stopPct * 100).toFixed(1)}% ATR): $${last.toFixed(2)} below HWM floor $${trailStopPrice.toFixed(2)} (HWM was $${pos.hwm.toFixed(2)})`,
        modelId: state.lastModelId,
        schwabOrderId: orderResult.orderId,
        placed: orderResult.ok,
        error: orderResult.error ?? null,
      });
      broadcastToClients("orderAlert", {
        type: reason === "stop_loss" ? "RULE_STOP_LOSS" : "RULE_TRAILING_STOP",
        symbol: ticker,
        side: "SELL",
        quantity: String(pos.shares),
        orderId: orderResult.orderId,
        status: orderResult.ok ? "PLACED" : "FAILED",
        timestamp: Date.now(),
        raw: "position-monitor",
      });
      logger.info(
        { userId, ticker, last, stopPrice, reason, shares: pos.shares, placed: orderResult.ok },
        "autoTrade monitor: stop triggered",
      );
    }
  }
}

async function runCycle(userId: string, state: RunnerState): Promise<void> {
  if (state.busy || state.stopRequested) return;
  state.busy = true;
  state.lastCycleAt = Date.now();

  try {
    const config = await getAutoTradeConfig(userId);
    if (!config.enabled || !config.running) {
      void stopAutoTrade(userId);
      return;
    }

    // Reset the daily budget accumulator at the ET day boundary.
    const dk = todayKey();
    if (dk !== state.dayKey) {
      state.dayKey = dk;
      state.deployedToday = 0;
      void generateAndStorePlaybook(userId);
    }

    if (!isTradingHours(config)) return;

    const account = await loadAccount(config);
    if (!account) {
      logger.warn({ userId }, "autoTrade: no account/token — skipping cycle");
      return;
    }

    // Daily max-loss guard: only count P&L from trades the auto-trader placed.
    const autoTradePnlToday = await getAutoTradeRealizedPnlToday(userId);
    if (autoTradePnlToday <= -Math.abs(config.dailyMaxLoss)) {
      logger.warn(
        { userId, autoTradePnlToday, limit: config.dailyMaxLoss },
        "autoTrade: daily max loss hit — halting",
      );
      await logAutoTradeDecision({
        userId,
        ticker: "—",
        decision: "HALT_DAILY_LOSS",
        reasoning: `Auto-trade realized P/L today: $${autoTradePnlToday.toFixed(2)} — breached limit -$${config.dailyMaxLoss}.`,
        placed: false,
      });
      broadcastToClients("autoTradeStatus", { userId, halted: "daily_loss", autoTradePnlToday });
      await stopAutoTrade(userId);
      return;
    }

    const accountHash = config.accountHash ?? account.hashValue;
    if (!accountHash) return;

    // Persist for the position monitor (runs between LLM cycles without a config load).
    state.lastAccountHash = accountHash;
    state.lastModelId = config.modelId;

    // EOD flatten — force-close all open positions in the 3:50–3:59 PM ET window.
    // Prevents overnight exposure when extended hours is disabled or flattenAtClose is on.
    if (config.flattenAtClose) {
      const etNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
      const minsNow = etNow.getHours() * 60 + etNow.getMinutes();
      if (minsNow >= 15 * 60 + 50 && minsNow < 16 * 60) {
        for (const [flatTicker, flatPos] of state.openPositions) {
          if (flatPos.exitPending) continue;
          flatPos.exitPending = true;
          const flatSnap = buildAutoTradeSnapshot(flatTicker);
          const flatLast = flatSnap.last ?? flatPos.hwm;
          const flatResult = await placeAutoEquityOrder(accountHash, flatTicker, "SELL", flatPos.shares, flatLast);
          if (flatResult.ok) {
            state.deployedToday = Math.max(0, state.deployedToday - flatPos.shares * flatLast);
            state.openPositions.delete(flatTicker);
            void recordTradeExit(userId, flatTicker, flatLast, flatPos.shares);
          } else {
            flatPos.exitPending = false;
          }
          await logAutoTradeDecision({
            userId, ticker: flatTicker, decision: "RULE_EOD_FLATTEN",
            instrument: "stock", quantity: flatPos.shares,
            reasoning: `EOD flatten: closing position before 4 PM market close`,
            modelId: config.modelId, schwabOrderId: flatResult.orderId,
            placed: flatResult.ok, error: flatResult.error ?? null,
          });
        }
        return; // skip LLM evaluation during the close window
      }
    }

    const playbook = await getStoredPlaybook(userId);

    // Resync deployedToday from account reality — guards against restart drift.
    // If the server restarted mid-trade, state.deployedToday resets to 0 while
    // the account still has open positions. Take the max of tracked vs live exposure.
    let liveExposure = 0;
    for (const ticker of config.tickers) {
      const shares = longSharesFor(account, ticker);
      if (shares > 0) {
        const snap = buildAutoTradeSnapshot(ticker);
        if (snap.last != null) liveExposure += shares * snap.last;
      }
    }
    if (liveExposure > state.deployedToday) {
      logger.info({ userId, liveExposure, was: state.deployedToday }, "autoTrade: resynced deployedToday from account");
      state.deployedToday = liveExposure;
    }

    // Snapshot budget once — each ticker's LLM call sees the same value.
    // Budget is re-checked against live state.deployedToday in Phase 3 before execution.
    const budgetAtCycleStart = Math.max(0, config.totalBudget - state.deployedToday);

    const tickersToEval = state.stopRequested ? [] : config.tickers;

    // ── Phase 2: Fire ALL LLM decisions in parallel ──────────────────────────────
    const results = await Promise.all(
      tickersToEval.map(async (ticker): Promise<TickerResult> => {
        const snapshot = buildAutoTradeSnapshot(ticker);
        if (!snapshot.tradeable || snapshot.last == null) return { kind: "skip" };

        const last = snapshot.last;
        const heldShares = longSharesFor(account, ticker);
        const hasPosition = heldShares > 0;
        const trailingStopPos = state.activeTrailingStops.get(ticker);

        if (trailingStopPos && !hasPosition) {
          return { kind: "trailing_stop_hit", ticker, snapshot, pos: trailingStopPos };
        }
        if (trailingStopPos && hasPosition) {
          return { kind: "trailing_active" };
        }

        // Backup rule-based exit check — the 5-sec monitor handles stops continuously,
        // but this catches anything that slipped through before we call the LLM.
        const openPos = state.openPositions.get(ticker);
        if (openPos && hasPosition && !openPos.exitPending) {
          if (last > openPos.hwm) openPos.hwm = last; // keep HWM in sync

          const trailStopPrice = openPos.hwm * (1 - openPos.stopPct);
          const hardStopPrice  = openPos.entryPrice * (1 - openPos.stopPct);
          const stopPrice = Math.max(trailStopPrice, hardStopPrice);

          const profitTargetPct = openPos.profitTargetPct ?? openPos.stopPct * 1.5;
          if (last >= openPos.entryPrice * (1 + profitTargetPct)) {
            return { kind: "rule_exit", ticker, last, heldShares, reason: "profit_target" };
          }
          if (last <= stopPrice) {
            return {
              kind: "rule_exit",
              ticker, last, heldShares,
              reason: last <= hardStopPrice ? "stop_loss" : "trailing_stop",
            };
          }
          if ((Date.now() - openPos.entryTime) >= TIME_STOP_MS && last <= openPos.entryPrice) {
            return { kind: "rule_exit", ticker, last, heldShares, reason: "time_stop" };
          }
        }

        // Build enriched position context for the LLM.
        let positionSummary = "None";
        if (hasPosition) {
          positionSummary = `Long ${heldShares} shares`;
          if (openPos) {
            const pnlPct = ((last - openPos.entryPrice) / openPos.entryPrice) * 100;
            const heldMin = Math.round((Date.now() - openPos.entryTime) / 60_000);
            const stopPrice = Math.max(
              openPos.hwm * (1 - openPos.stopPct),
              openPos.entryPrice * (1 - openPos.stopPct),
            );
            positionSummary =
              `Long ${heldShares} sh @ $${openPos.entryPrice.toFixed(2)} | ` +
              `P&L ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}% | ` +
              `HWM $${openPos.hwm.toFixed(2)} | stop $${stopPrice.toFixed(2)} | held ${heldMin}m`;
          }
        }

        const decision = await decideAutoTrade({
          snapshot,
          modelId: config.modelId,
          instrumentMode: config.instrumentMode,
          maxPerTrade: config.maxPerTrade,
          budgetRemaining: budgetAtCycleStart,
          hasPosition,
          positionSummary,
          playbook,
        });

        return { kind: "decision", ticker, snapshot, last, heldShares, decision };
      }),
    );

    // ── Phase 3: Execute sequentially — budget updates stay accurate ─────────────
    for (const result of results) {
      if (state.stopRequested) break;

      if (result.kind === "skip" || result.kind === "trailing_active") continue;

      if (result.kind === "trailing_stop_hit") {
        const { ticker, snapshot, pos } = result;
        state.activeTrailingStops.delete(ticker);
        state.openPositions.delete(ticker);
        state.deployedToday = Math.max(0, state.deployedToday - pos.shares * pos.entryPrice);
        if (snapshot.last != null) void recordTradeExit(userId, ticker, snapshot.last, pos.shares);
        await logAutoTradeDecision({
          userId,
          ticker,
          decision: "TRAILING_STOP_HIT",
          instrument: "stock",
          quantity: pos.shares,
          reasoning: `Trailing stop triggered — position closed near $${snapshot.last?.toFixed(2) ?? "?"}`,
          modelId: config.modelId,
          placed: false,
        });
        continue;
      }

      if (result.kind === "rule_exit") {
        const { ticker, last, heldShares, reason } = result;
        const pos = state.openPositions.get(ticker);
        if (pos) pos.exitPending = true;

        const orderResult = await placeAutoEquityOrder(accountHash, ticker, "SELL", heldShares, last);
        if (orderResult.ok) {
          state.deployedToday = Math.max(0, state.deployedToday - heldShares * last);
          state.openPositions.delete(ticker);
          void recordTradeExit(userId, ticker, last, heldShares);
        } else if (pos) {
          pos.exitPending = false; // allow retry
        }
        await logAutoTradeDecision({
          userId,
          ticker,
          decision: reason === "stop_loss" ? "RULE_STOP_LOSS"
                  : reason === "trailing_stop" ? "RULE_TRAILING_STOP"
                  : reason === "profit_target" ? "RULE_PROFIT_TARGET"
                  : "RULE_TIME_STOP",
          instrument: "stock",
          quantity: heldShares,
          reasoning: reason === "stop_loss"
            ? `Rule hard stop (${(pos?.stopPct ? (pos.stopPct * 100).toFixed(1) : "2.0")}% ATR): $${last.toFixed(2)} — exit without LLM.`
            : reason === "trailing_stop"
            ? `Rule trailing stop: $${last.toFixed(2)} crossed below HWM floor — exit without LLM.`
            : reason === "profit_target"
            ? `Rule profit target (${(pos?.profitTargetPct ? (pos.profitTargetPct * 100).toFixed(1) : "3.0")}%): $${last.toFixed(2)} — scalp target reached.`
            : `Rule time-stop: held >5 min with no profit ($${last.toFixed(2)}) — exit without LLM.`,
          modelId: config.modelId,
          schwabOrderId: orderResult.orderId,
          placed: orderResult.ok,
          error: orderResult.error ?? null,
        });
        continue;
      }

      const { ticker, snapshot, last, heldShares, decision } = result;
      const hasPosition = heldShares > 0;

      if (decision.action === "HOLD") {
        await logAutoTradeDecision({
          userId, ticker, decision: "HOLD",
          reasoning: decision.reasoning, modelId: config.modelId, placed: false,
        });
        continue;
      }

      if (decision.action === "SELL") {
        if (!hasPosition) continue;
        const pos = state.openPositions.get(ticker);
        if (pos?.exitPending) continue; // monitor is already handling this exit
        if (pos) pos.exitPending = true;

        const orderResult = await placeAutoEquityOrder(accountHash, ticker, "SELL", heldShares, last);
        await logAutoTradeDecision({
          userId, ticker, decision: "SELL", instrument: "stock", quantity: heldShares,
          reasoning: decision.reasoning, modelId: config.modelId,
          schwabOrderId: orderResult.orderId, placed: orderResult.ok, error: orderResult.error ?? null,
        });
        if (orderResult.ok) {
          state.deployedToday = Math.max(0, state.deployedToday - heldShares * last);
          state.openPositions.delete(ticker);
          void recordTradeExit(userId, ticker, last, heldShares);
        } else if (pos) {
          pos.exitPending = false; // allow retry
        }
        continue;
      }

      if (decision.action === "BUY_STOCK") {
        // Re-check live budget — parallel decisions may have caused another ticker to buy first.
        const budgetNow = Math.max(0, config.totalBudget - state.deployedToday);
        const shares = Math.floor(decision.notional / last);
        if (shares < 1 || budgetNow < last) {
          await logAutoTradeDecision({
            userId, ticker, decision: "BUY_STOCK", instrument: "stock", notional: decision.notional,
            reasoning: `${decision.reasoning} (skipped: budget/share too small)`,
            modelId: config.modelId, placed: false,
          });
          continue;
        }

        const orderResult = await placeAutoEquityOrder(accountHash, ticker, "BUY", shares, last);
        if (orderResult.ok) {
          state.deployedToday += shares * last;
          const stopPct = computeStopPct(snapshot.atr14, last);
          state.openPositions.set(ticker, {
            shares,
            entryPrice: last,
            entryTime: Date.now(),
            stopPct,
            profitTargetPct: stopPct * 1.5,
            hwm: last,
            exitPending: false,
          });
          logger.info(
            { userId, ticker, last, shares, stopPct: `${(stopPct * 100).toFixed(2)}%` },
            "autoTrade BUY: position opened with ATR stop",
          );
        }
        await logAutoTradeDecision({
          userId, ticker, decision: "BUY_STOCK", instrument: "stock",
          quantity: shares, notional: shares * last,
          reasoning: decision.reasoning,
          modelId: config.modelId, schwabOrderId: orderResult.orderId,
          placed: orderResult.ok, error: orderResult.error ?? null,
        });
        if (orderResult.ok && orderResult.orderId) {
          await journalAutoEntry({
            orderId: orderResult.orderId, symbol: ticker, direction: "BUY",
            entryPrice: last, quantity: shares, thesis: decision.reasoning, accountHash,
          });
        }
        continue;
      }

      // BUY_CALL / BUY_PUT — logged only.
      await logAutoTradeDecision({
        userId, ticker, decision: decision.action,
        instrument: decision.action === "BUY_CALL" ? "call" : "put",
        notional: decision.notional,
        reasoning: `${decision.reasoning} (options execution pending — logged only)`,
        modelId: config.modelId, placed: false,
      });
    }
  } catch (err) {
    logger.error({ err, userId }, "autoTrade cycle error");
  } finally {
    state.busy = false;
  }
}

/** Start (or restart) the autonomous loop for a user. Idempotent. */
export async function startAutoTrade(userId: string): Promise<void> {
  const config = await getAutoTradeConfig(userId);
  await setAutoTradeRunning(userId, true);

  const existing = runners.get(userId);
  if (existing?.timer) clearInterval(existing.timer);
  if (existing?.monitorTimer) clearInterval(existing.monitorTimer);

  const state: RunnerState = existing ?? {
    busy: false,
    stopRequested: false,
    deployedToday: 0,
    dayKey: todayKey(),
    timer: null,
    monitorTimer: null,
    lastCycleAt: 0,
    activeTrailingStops: new Map(),
    openPositions: new Map(),
    lastAccountHash: null,
    lastModelId: config.modelId,
  };
  state.stopRequested = false;
  state.busy = false;

  const intervalMs = Math.max(15, config.pollIntervalSec) * 1000;
  state.timer = setInterval(() => void runCycle(userId, state), intervalMs);
  // Fast monitor runs independently — stops fire within 5 s of the price crossing the floor,
  // not on the next 60-second LLM cycle.
  state.monitorTimer = setInterval(() => void runPositionMonitor(userId, state), POSITION_MONITOR_INTERVAL_MS);
  runners.set(userId, state);

  if (config.tickers.length > 0) {
    addSymbols(config.tickers);
    addChartEquitySymbols(config.tickers);
  }

  logger.info({ userId, intervalMs, tickers: config.tickers }, "autoTrade started");
  broadcastToClients("autoTradeStatus", { userId, running: true });

  // Kick an immediate first cycle rather than waiting a full interval.
  void runCycle(userId, state);
}

/** Stop the loop for a user and clear the running flag. */
export async function stopAutoTrade(userId: string): Promise<void> {
  const state = runners.get(userId);
  if (state) {
    state.stopRequested = true;
    if (state.timer) clearInterval(state.timer);
    if (state.monitorTimer) clearInterval(state.monitorTimer);
    state.timer = null;
    state.monitorTimer = null;
  }
  runners.delete(userId);
  try {
    await setAutoTradeRunning(userId, false);
  } catch (err) {
    logger.warn({ err, userId }, "autoTrade stop: failed to clear running flag");
  }
  logger.info({ userId }, "autoTrade stopped");
  broadcastToClients("autoTradeStatus", { userId, running: false });
}

export function isAutoTradeRunning(userId: string): boolean {
  return runners.has(userId);
}

/**
 * On server boot the in-memory runner map is empty, so any config row still
 * flagged running=true is stale. Clear those flags so the UI reflects reality
 * rather than silently auto-resuming autonomous trading after a restart.
 */
export async function reconcileAutoTradeOnBoot(): Promise<void> {
  try {
    const { db, eq } = await import("@workspace/db");
    const { autoTradeConfigTable } = await import("@workspace/db/schema");
    await db
      .update(autoTradeConfigTable)
      .set({ running: false })
      .where(eq(autoTradeConfigTable.running, true));
  } catch (err) {
    logger.warn({ err }, "autoTrade reconcileOnBoot failed");
  }
}

export function autoTradeRunnerInfo(userId: string): { running: boolean; deployedToday: number; lastCycleAt: number } {
  const state = runners.get(userId);
  return {
    running: !!state,
    deployedToday: state?.deployedToday ?? 0,
    lastCycleAt: state?.lastCycleAt ?? 0,
  };
}
