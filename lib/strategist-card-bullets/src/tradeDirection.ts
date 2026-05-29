export type TradeDirection = "BULLISH" | "BEARISH" | "NEUTRAL";

export type TradeLeg = {
  type: "call" | "put";
  action: "buy" | "sell";
  strike?: number;
};

export type DebateVerdict = "BULLISH" | "BEARISH" | "SIDEWAYS";

/**
 * Derive card/API trade direction from structure (strategy + legs), then debate verdict.
 * Never use agent persona names ("Bear", risk-manager, etc.).
 */
export function deriveTradeDirection(
  strategy: string | undefined | null,
  legs: ReadonlyArray<TradeLeg> | undefined,
  debateVerdict?: DebateVerdict | null,
): TradeDirection {
  const s = (strategy ?? "").toLowerCase();

  if (
    /(iron_condor|iron_butterfly|butterfly|straddle|strangle|calendar|double_calendar|diagonal)/.test(
      s,
    )
  ) {
    return "NEUTRAL";
  }

  if (/(bull_put|bull_call|bull_|long_call|put_credit|call_debit|naked_put)/.test(s)) {
    return "BULLISH";
  }
  if (/(bear_put|bear_call|bear_|long_put|call_credit|put_debit|naked_call)/.test(s)) {
    return "BEARISH";
  }

  const vertical = inferVerticalSpreadDirection(legs);
  if (vertical) return vertical;

  if (legs && legs.length === 1) {
    const leg = legs[0];
    if (leg.action === "buy") return leg.type === "call" ? "BULLISH" : "BEARISH";
    if (leg.action === "sell") return leg.type === "put" ? "BULLISH" : "BEARISH";
  }

  if (debateVerdict === "BULLISH" || debateVerdict === "BEARISH") {
    return debateVerdict;
  }

  if (legs && legs.length > 0) {
    let callBias = 0;
    let putBias = 0;
    for (const l of legs) {
      const sign = l.action === "buy" ? 1 : -1;
      if (l.type === "call") callBias += sign;
      else putBias += sign;
    }
    if (callBias > 0 && putBias <= 0) return "BULLISH";
    if (putBias > 0 && callBias <= 0) return "BEARISH";
  }

  return "NEUTRAL";
}

/** Map NEUTRAL → NON_DIRECTIONAL for legacy strategist card payloads. */
export function tradeDirectionToCardLabel(
  direction: TradeDirection,
): "BULLISH" | "BEARISH" | "NON_DIRECTIONAL" {
  if (direction === "BULLISH") return "BULLISH";
  if (direction === "BEARISH") return "BEARISH";
  return "NON_DIRECTIONAL";
}

function inferVerticalSpreadDirection(
  legs: ReadonlyArray<TradeLeg> | undefined,
): TradeDirection | null {
  if (!legs || legs.length !== 2) return null;
  const buys = legs.filter((l) => l.action === "buy");
  const sells = legs.filter((l) => l.action === "sell");
  if (buys.length !== 1 || sells.length !== 1) return null;

  const buy = buys[0];
  const sell = sells[0];
  if (buy.type !== sell.type) return null;

  const bStrike = buy.strike;
  const sStrike = sell.strike;
  if (
    bStrike != null &&
    sStrike != null &&
    Number.isFinite(bStrike) &&
    Number.isFinite(sStrike) &&
    bStrike !== sStrike
  ) {
    if (buy.type === "put") {
      if (sStrike > bStrike) return "BULLISH";
      if (sStrike < bStrike) return "BEARISH";
    }
    if (buy.type === "call") {
      if (bStrike < sStrike) return "BULLISH";
      if (bStrike > sStrike) return "BEARISH";
    }
    return "NEUTRAL";
  }

  if (sell.type === "put") return "BULLISH";
  if (sell.type === "call") return "BEARISH";
  return null;
}
