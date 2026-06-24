/**
 * Pure risk guards — zero I/O, zero side effects.
 * Every check returns [allowed: boolean, reason: string].
 */
import type { Signal, RiskState, AccountState, Position, Config } from "./types.js";

export function canEnter(
  signal: Signal,
  risk: RiskState,
  acct: AccountState,
  pos: Position | null,
  cfg: Config,
): [boolean, string] {
  if (risk.halted)         return [false, risk.haltReason ?? "halted"];
  if (risk.dailyLossHalt)  return [false, "daily loss halt"];
  if (risk.cooldownUntil && new Date() < risk.cooldownUntil)
    return [false, `cooldown until ${risk.cooldownUntil.toLocaleTimeString("en-US", { timeZone: "America/New_York" })} ET`];
  if (risk.tradesToday >= cfg.tradesPerDay)
    return [false, `max ${cfg.tradesPerDay} trades/day reached`];
  if (risk.symbolsTradedToday.includes(signal.symbol))
    return [false, `${signal.symbol} already traded today`];
  if (risk.lossStreak >= cfg.lossStreakLimit)
    return [false, `loss streak ${risk.lossStreak}/${cfg.lossStreakLimit}`];
  if (pos && !pos.isFlat)
    return [false, `position open in ${pos.symbol}`];

  // Price sanity
  if (signal.entryPrice <= 0 || signal.stopPrice <= 0 || signal.targetPrice <= 0)
    return [false, "invalid prices"];
  if (signal.stopPrice >= signal.entryPrice)
    return [false, "stop >= entry"];
  if (signal.targetPrice <= signal.entryPrice)
    return [false, "target <= entry"];
  if (signal.size < 1)
    return [false, "size < 1 share"];

  // Risk dollar cap
  const riskDollars = (signal.entryPrice - signal.stopPrice) * signal.size;
  const maxRisk     = cfg.startingEquity * cfg.riskPerTradePct;
  if (riskDollars > maxRisk * 1.05) // 5% tolerance for rounding
    return [false, `risk $${riskDollars.toFixed(2)} exceeds limit $${maxRisk.toFixed(2)}`];

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
