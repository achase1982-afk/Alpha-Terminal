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

interface TrailingStopPosition {
  shares: number;
  entryPrice: number;
}

interface OpenPosition {
  shares: number;
  entryPrice: number;
  entryTime: number;
}

// Hard rule-based exit constants — no LLM involved.
const STOP_LOSS_PCT = 0.0075;    // 0.75% below entry → immediate SELL
const TIME_STOP_MS = 5 * 60_000; // 5 min held with no profit → exit

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
  lastCycleAt: number;
  /** Tickers currently managed by a trailing stop order — LLM decisions are skipped for these. */
  activeTrailingStops: Map<string, TrailingStopPosition>;
  /** In-memory position book — entry price + time for rule-based stop loss and time stop. */
  openPositions: Map<string, OpenPosition>;
}

const runners = new Map<string, RunnerState>();

function todayKey(): string {
  return new Date().toLocaleDateString("en-US", { timeZone: "America/New_York" });
}

function isRegularMarketHours(): boolean {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = et.getHours() * 60 + et.getMinutes();
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
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

type TickerResult =
  | { kind: "skip" }
  | { kind: "trailing_stop_hit"; ticker: string; snapshot: AutoTradeSnapshot; pos: TrailingStopPosition }
  | { kind: "trailing_active" }
  | { kind: "rule_exit"; ticker: string; last: number; heldShares: number; reason: string }
  | { kind: "decision"; ticker: string; snapshot: AutoTradeSnapshot; last: number; heldShares: number; decision: AutoTradeDecision };

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

    if (!isRegularMarketHours()) return;

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

    const playbook = await getStoredPlaybook(userId);

    // Snapshot budget once — each ticker's LLM call sees the same value.
    // Budget is re-checked against the live state.deployedToday in Phase 3 before execution.
    const budgetAtCycleStart = Math.max(0, config.totalBudget - state.deployedToday);

    // ── Phase 1: Build snapshots (synchronous, no I/O) ──────────────────────────
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

        // Rule-based exits — bypass LLM entirely. Faster and more reliable than asking the model.
        const openPos = state.openPositions.get(ticker);
        if (openPos && hasPosition) {
          const pnlPct = (last - openPos.entryPrice) / openPos.entryPrice;
          const heldMs = Date.now() - openPos.entryTime;
          if (pnlPct <= -STOP_LOSS_PCT) {
            return { kind: "rule_exit", ticker, last, heldShares, reason: "stop_loss" };
          }
          if (heldMs >= TIME_STOP_MS && pnlPct <= 0) {
            return { kind: "rule_exit", ticker, last, heldShares, reason: "time_stop" };
          }
        }

        let positionSummary = "None";
        if (hasPosition) {
          positionSummary = `Long ${heldShares} shares`;
          if (openPos) {
            const pnlPct = ((last - openPos.entryPrice) / openPos.entryPrice) * 100;
            const heldMin = Math.round((Date.now() - openPos.entryTime) / 60_000);
            positionSummary = `Long ${heldShares} sh @ $${openPos.entryPrice.toFixed(2)} | P&L ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}% | held ${heldMin}m`;
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
        // Free up the exposure so the budget can be redeployed into the next entry.
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
        const orderResult = await placeAutoEquityOrder(accountHash, ticker, "SELL", heldShares);
        if (orderResult.ok) {
          state.deployedToday = Math.max(0, state.deployedToday - heldShares * last);
          state.openPositions.delete(ticker);
          void recordTradeExit(userId, ticker, last, heldShares);
        }
        await logAutoTradeDecision({
          userId,
          ticker,
          decision: reason === "stop_loss" ? "RULE_STOP_LOSS" : "RULE_TIME_STOP",
          instrument: "stock",
          quantity: heldShares,
          reasoning: reason === "stop_loss"
            ? `Rule stop-loss: price dropped ≥0.75% from entry ($${last.toFixed(2)}) — exiting without LLM.`
            : `Rule time-stop: held >5 min with no profit ($${last.toFixed(2)}) — exiting without LLM.`,
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
        const orderResult = await placeAutoEquityOrder(accountHash, ticker, "SELL", heldShares);
        await logAutoTradeDecision({
          userId, ticker, decision: "SELL", instrument: "stock", quantity: heldShares,
          reasoning: decision.reasoning, modelId: config.modelId,
          schwabOrderId: orderResult.orderId, placed: orderResult.ok, error: orderResult.error ?? null,
        });
        if (orderResult.ok) {
          // Free up the exposure so the budget can be redeployed.
          state.deployedToday = Math.max(0, state.deployedToday - heldShares * last);
          state.openPositions.delete(ticker);
          void recordTradeExit(userId, ticker, last, heldShares);
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

        const orderResult = await placeAutoEquityOrder(accountHash, ticker, "BUY", shares);
        if (orderResult.ok) {
          state.deployedToday += shares * last;
          state.openPositions.set(ticker, { shares, entryPrice: last, entryTime: Date.now() });
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

  const state: RunnerState = existing ?? {
    busy: false,
    stopRequested: false,
    deployedToday: 0,
    dayKey: todayKey(),
    timer: null,
    lastCycleAt: 0,
    activeTrailingStops: new Map(),
    openPositions: new Map(),
  };
  state.stopRequested = false;
  state.busy = false;

  const intervalMs = Math.max(15, config.pollIntervalSec) * 1000;
  state.timer = setInterval(() => void runCycle(userId, state), intervalMs);
  runners.set(userId, state);

  // Ensure configured tickers receive Level 1 quotes + 1-min bars from the streamer.
  // addSymbols / addChartEquitySymbols are idempotent — safe to call every start.
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
    state.timer = null;
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
