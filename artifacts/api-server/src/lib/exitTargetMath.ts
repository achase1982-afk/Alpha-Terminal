/**
 * Defined-risk debit-structure profit-target clamp.
 *
 * Bug 3 (P0): the AI generated a profit target of $3.30/share on a 705/700
 * bear put spread with a $1.81 debit. Theoretical max profit per share for
 * that spread = strike_width − debit = $5.00 − $1.81 = $3.19. The target
 * exceeded the maximum the structure can physically pay.
 *
 * For ANY defined-risk debit structure, max profit per share is bounded by
 * (max_spread_value − debit). Since the strategist already computes the
 * dollar `maxProfit` from real Schwab leg prices after the AI responds,
 * (max_spread_value − debit) per share == maxProfit / 100 (per 1-lot).
 *
 * This clamp is intentionally agnostic to whether `profitTarget` is read as
 * "exit option price" or "profit per share" downstream — either way, the
 * realized profit cannot exceed maxProfit/100, so capping at that ceiling
 * (minus a tick buffer for bid/ask reality) is always safe.
 *
 * Credit structures and unbounded-profit structures are intentionally NOT
 * clamped here.
 */

export const PROFIT_TARGET_TICK_BUFFER = 0.05;

export interface ClampInputs {
  profitTarget: number;
  /** Dollar max profit per 1 lot, as computed from real leg prices. */
  maxProfit: number;
  isCredit: boolean;
}

export interface ClampResult {
  clamped: number;
  wasClamped: boolean;
  cap: number | null;
  reason?: "credit_structure" | "unbounded_max_profit" | "non_positive_max_profit" | "non_positive_target";
}

/**
 * Sentinel emitted by the prompt for "theoretically unlimited" maxProfit
 * (long calls/puts, naked structures, etc). Matches strategistV2 prompt
 * contract: `maxProfit: number (... or 99999 for theoretically unlimited)`.
 */
const UNBOUNDED_SENTINEL = 99999;

export function clampProfitTargetToMaxPayout(input: ClampInputs): ClampResult {
  const { profitTarget, maxProfit, isCredit } = input;

  if (!Number.isFinite(profitTarget) || profitTarget <= 0) {
    return { clamped: profitTarget, wasClamped: false, cap: null, reason: "non_positive_target" };
  }
  if (isCredit) {
    return { clamped: profitTarget, wasClamped: false, cap: null, reason: "credit_structure" };
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
