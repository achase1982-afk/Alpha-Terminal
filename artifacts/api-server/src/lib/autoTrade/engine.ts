import { getTokens } from "../tokenStore.js";
import { logger } from "../logger.js";
import { broadcastToClients } from "../wsServer.js";
import { fetchMappedSchwabAccounts } from "../schwabPortfolioAccounts.js";
import { getAutoTradeConfig, setAutoTradeRunning, type AutoTradeConfig } from "./config.js";
import { buildAutoTradeSnapshot } from "./snapshot.js";
import { decideAutoTrade } from "./decision.js";
import { placeAutoEquityOrder, logAutoTradeDecision, journalAutoEntry } from "./execute.js";

interface RunnerState {
  busy: boolean;
  stopRequested: boolean;
  deployedToday: number;
  dayKey: string;
  timer: NodeJS.Timeout | null;
  lastCycleAt: number;
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
    }

    if (!isRegularMarketHours()) return;

    const account = await loadAccount(config);
    if (!account) {
      logger.warn({ userId }, "autoTrade: no account/token — skipping cycle");
      return;
    }

    // Daily max-loss guard: halt the whole loop for the day if breached.
    if (account.dayPL <= -Math.abs(config.dailyMaxLoss)) {
      logger.warn(
        { userId, dayPL: account.dayPL, limit: config.dailyMaxLoss },
        "autoTrade: daily max loss hit — halting",
      );
      await logAutoTradeDecision({
        userId,
        ticker: "—",
        decision: "HALT_DAILY_LOSS",
        reasoning: `Day P/L ${account.dayPL.toFixed(2)} breached limit -${config.dailyMaxLoss}.`,
        placed: false,
      });
      broadcastToClients("autoTradeStatus", { userId, halted: "daily_loss", dayPL: account.dayPL });
      await stopAutoTrade(userId);
      return;
    }

    const accountHash = config.accountHash ?? account.hashValue;
    if (!accountHash) return;

    for (const ticker of config.tickers) {
      if (state.stopRequested) break;
      const budgetRemaining = Math.max(0, config.totalBudget - state.deployedToday);
      const snapshot = buildAutoTradeSnapshot(ticker);
      if (!snapshot.tradeable || snapshot.last == null) continue;

      const heldShares = longSharesFor(account, ticker);
      const hasPosition = heldShares > 0;

      const decision = await decideAutoTrade({
        snapshot,
        modelId: config.modelId,
        instrumentMode: config.instrumentMode,
        maxPerTrade: config.maxPerTrade,
        budgetRemaining,
        hasPosition,
        positionSummary: hasPosition ? `Long ${heldShares} shares` : "None",
      });

      if (decision.action === "HOLD") {
        await logAutoTradeDecision({
          userId,
          ticker,
          decision: "HOLD",
          reasoning: decision.reasoning,
          modelId: config.modelId,
          placed: false,
        });
        continue;
      }

      if (decision.action === "SELL") {
        if (!hasPosition) continue;
        const result = await placeAutoEquityOrder(accountHash, ticker, "SELL", heldShares);
        await logAutoTradeDecision({
          userId,
          ticker,
          decision: "SELL",
          instrument: "stock",
          quantity: heldShares,
          reasoning: decision.reasoning,
          modelId: config.modelId,
          schwabOrderId: result.orderId,
          placed: result.ok,
          error: result.error ?? null,
        });
        continue;
      }

      if (decision.action === "BUY_STOCK") {
        const shares = Math.floor(decision.notional / snapshot.last);
        if (shares < 1 || budgetRemaining < snapshot.last) {
          await logAutoTradeDecision({
            userId,
            ticker,
            decision: "BUY_STOCK",
            instrument: "stock",
            notional: decision.notional,
            reasoning: `${decision.reasoning} (skipped: budget/share too small)`,
            modelId: config.modelId,
            placed: false,
          });
          continue;
        }
        const result = await placeAutoEquityOrder(accountHash, ticker, "BUY", shares);
        if (result.ok) state.deployedToday += shares * snapshot.last;
        await logAutoTradeDecision({
          userId,
          ticker,
          decision: "BUY_STOCK",
          instrument: "stock",
          quantity: shares,
          notional: shares * snapshot.last,
          reasoning: decision.reasoning,
          modelId: config.modelId,
          schwabOrderId: result.orderId,
          placed: result.ok,
          error: result.error ?? null,
        });
        if (result.ok && result.orderId) {
          await journalAutoEntry({
            orderId: result.orderId,
            symbol: ticker,
            direction: "BUY",
            entryPrice: snapshot.last,
            quantity: shares,
            thesis: decision.reasoning,
            accountHash,
          });
        }
        continue;
      }

      // BUY_CALL / BUY_PUT — decision captured; options execution not yet wired.
      await logAutoTradeDecision({
        userId,
        ticker,
        decision: decision.action,
        instrument: decision.action === "BUY_CALL" ? "call" : "put",
        notional: decision.notional,
        reasoning: `${decision.reasoning} (options execution pending — logged only)`,
        modelId: config.modelId,
        placed: false,
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
  };
  state.stopRequested = false;
  state.busy = false;

  const intervalMs = Math.max(15, config.pollIntervalSec) * 1000;
  state.timer = setInterval(() => void runCycle(userId, state), intervalMs);
  runners.set(userId, state);

  logger.info({ userId, intervalMs }, "autoTrade started");
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
