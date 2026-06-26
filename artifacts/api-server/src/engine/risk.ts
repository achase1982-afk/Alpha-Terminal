/**
 * Pure risk guards & dollar sizing — zero I/O, zero side effects.
 * Every check returns [allowed: boolean, reason: string].
 *
 * Sizing and limits are dollar-based (Total Budget / Max-per-Trade / Daily Max
 * Loss from the Auto Trader UI). There is no percentage-based sizing or halt.
 */
import type { Signal, RiskState, AccountState, Position, Config } from "./types.js";

/**
 * Share count for a dollar-budgeted entry:
 *   floor( min(MaxPerTrade, TotalBudget − currentOpenExposure) / entryPrice )
 * The protective stop does NOT change the share count.
 */
export function sizeByDollars(
  entryPrice: number,
  cfg: Config,
  openExposure: number,
): number {
  if (!(entryPrice > 0)) return 0;
  const budgetRoom = Math.max(0, cfg.totalBudget - openExposure);
  const notional = Math.min(cfg.maxPerTrade, budgetRoom);
  if (notional <= 0) return 0;
  return Math.floor(notional / entryPrice);
}

export function canEnter(
  signal: Signal,
  risk: RiskState,
  acct: AccountState,
  pos: Position | null,
  cfg: Config,
  openExposure: number,
): [boolean, string] {
  if (risk.halted)         return [false, risk.haltReason ?? "halted"];
  if (risk.dailyLossHalt)  return [false, "daily max loss halt"];
  if (risk.cooldownUntil && new Date() < risk.cooldownUntil)
    return [false, `cooldown until ${risk.cooldownUntil.toLocaleTimeString("en-US", { timeZone: "America/New_York" })} ET`];
  if (risk.tradesToday >= cfg.tradesPerDay)
    return [false, `max ${cfg.tradesPerDay} trades/day reached`];
  // Note: no "already traded this symbol today" guard — the engine is
  // continuous and re-enters the same symbol many times. The open-position
  // check below enforces at most one position per symbol at a time.
  if (risk.lossStreak >= cfg.lossStreakLimit)
    return [false, `loss streak ${risk.lossStreak}/${cfg.lossStreakLimit}`];
  if (pos && !pos.isFlat)
    return [false, `position open in ${pos.symbol}`];

  // Price sanity (long only)
  if (signal.entryPrice <= 0 || signal.stopPrice <= 0)
    return [false, "invalid prices"];
  if (signal.stopPrice >= signal.entryPrice)
    return [false, "stop >= entry"];
  if (signal.size < 1)
    return [false, "size < 1 share"];

  // Dollar budget: this entry's notional must fit under the open-exposure ceiling.
  const entryNotional = signal.entryPrice * signal.size;
  if (entryNotional > cfg.maxPerTrade * 1.05) // 5% tolerance for rounding
    return [false, `entry $${entryNotional.toFixed(0)} exceeds max/trade $${cfg.maxPerTrade.toFixed(0)}`];
  if (openExposure + entryNotional > cfg.totalBudget * 1.05)
    return [false, `would exceed total budget $${cfg.totalBudget.toFixed(0)} (open $${openExposure.toFixed(0)})`];

  return [true, "ok"];
}

/** Update risk state after a completed trade. */
export function recordTrade(
  risk: RiskState,
  symbol: string,
  pnl: number,
  cfg: Config,
): void {
  risk.tradesToday++;
  if (!risk.symbolsTradedToday.includes(symbol)) {
    risk.symbolsTradedToday.push(symbol);
  }
  if (pnl < 0) {
    risk.lossStreak++;
    if (risk.lossStreak >= cfg.lossStreakLimit) {
      const until = new Date();
      until.setMinutes(until.getMinutes() + cfg.cooldownMinutes);
      risk.cooldownUntil = until;
    }
  } else {
    risk.lossStreak = 0;
  }
}

/** Reset daily counters (call at day boundary). */
export function resetDailyRisk(risk: RiskState): void {
  risk.dailyLossHalt = false;
  risk.tradesToday = 0;
  risk.symbolsTradedToday = [];
  risk.lossStreak = 0;
  risk.cooldownUntil = undefined;
}
