/**
 * Defined-risk profit-target clamp (debit AND credit structures).
 *
 * Bug 3 (P0): the AI generated a profit target of $3.30/share on a 705/700
 * bear put spread with a $1.81 debit. Theoretical max profit per share for
 * that spread = strike_width − debit = $5.00 − $1.81 = $3.19. The target
 * exceeded the maximum the structure can physically pay.
 *
 * For ANY defined-risk structure (debit OR credit verticals, iron condors,
 * iron butterflies), max profit per share is bounded by `maxProfit / 100`
 * since the strategist already recomputes `maxProfit` from real Schwab leg
 * prices after the AI responds (see reconcileEconomicsWithLegs).
 *
 *   - Debit vertical:  maxProfit = (width − debit) × 100
 *   - Credit vertical: maxProfit = credit_collected × 100
 *   - Iron condor/fly: maxProfit = total_net_credit × 100
 *
 * The clamp is agnostic to whether `profitTarget` is interpreted downstream
 * as "exit option price" or "profit per share":
 *
 *   - Debit, "exit option price": profit/share = exit − debit, bounded by
 *     (max_spread_value − debit) = maxProfit/100. Clamp at maxProfit/100 − ε.
 *   - Debit, "profit per share":  bounded directly by maxProfit/100. Same cap.
 *   - Credit, "closing debit":   profit/share = credit − close_debit, so for
 *     a profit-taking exit close_debit must be < credit. Capping the "target"
 *     at credit − ε (= maxProfit/100 − ε) guarantees at least ε profit/share.
 *   - Credit, "profit per share": bounded directly by credit_collected. Same cap.
 *
 * Either interpretation yields the same numeric ceiling, so the clamp is safe.
 *
 * UNBOUNDED structures (long call/put without a short wing, naked) are NOT
 * clamped here — `maxProfit` is the AI's theoretical estimate or the 99999
 * sentinel and the structure can in fact pay more than the prompt's guess.
 */

export const PROFIT_TARGET_TICK_BUFFER = 0.05;

export interface ClampInputs {
  profitTarget: number;
  /** Dollar max profit per 1 lot, as computed from real leg prices. */
  maxProfit: number;
  /**
   * Retained for telemetry and future per-side semantic tweaks; the cap
   * itself is the same for debit and credit (see module docstring).
   */
  isCredit: boolean;
}

export interface ClampResult {
  clamped: number;
  wasClamped: boolean;
  cap: number | null;
  reason?: "unbounded_max_profit" | "non_positive_max_profit" | "non_positive_target";
}

/**
 * Sentinel emitted by the prompt for "theoretically unlimited" maxProfit
 * (long calls/puts, naked structures, etc). Matches strategistV2 prompt
 * contract: `maxProfit: number (... or 99999 for theoretically unlimited)`.
 */
const UNBOUNDED_SENTINEL = 99999;

export function clampProfitTargetToMaxPayout(input: ClampInputs): ClampResult {
  const { profitTarget, maxProfit } = input;

  if (!Number.isFinite(profitTarget) || profitTarget <= 0) {
    return { clamped: profitTarget, wasClamped: false, cap: null, reason: "non_positive_target" };
  }
  if (!Number.isFinite(maxProfit) || maxProfit >= UNBOUNDED_SENTINEL) {
    return { clamped: profitTarget, wasClamped: false, cap: null, reason: "unbounded_max_profit" };
  }
  if (maxProfit <= 0) {
    return { clamped: profitTarget, wasClamped: false, cap: null, reason: "non_positive_max_profit" };
  }

  const maxProfitPerShare = maxProfit / 100;
  const cap = Math.max(0, maxProfitPerShare - PROFIT_TARGET_TICK_BUFFER);

  if (profitTarget > cap) {
    return { clamped: Math.round(cap * 100) / 100, wasClamped: true, cap };
  }
  return { clamped: profitTarget, wasClamped: false, cap };
}
