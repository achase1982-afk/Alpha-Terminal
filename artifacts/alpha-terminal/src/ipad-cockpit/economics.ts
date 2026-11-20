import { roundNickel } from "./format";
import type { IpadPresetLeg, IpadSide, IpadStagedLeg, IpadStrategy } from "./types";

export interface BracketEconomics {
  credit: boolean;
  tp: number;
  sl: number;
  cash: number;
  maxRisk: number;
}

export function legId(leg: Pick<IpadStagedLeg, "side" | "right" | "strike">): string {
  return `${leg.side}-${leg.right}-${leg.strike}`;
}

export function inferStrategy(legs: readonly IpadStagedLeg[]): IpadStrategy {
  if (legs.length <= 1) return "single";
  const [first, second] = legs;
  if (!first || !second || first.right !== second.right) return "debit";
  const sell = legs.find((leg) => leg.side === "SELL");
  const buy = legs.find((leg) => leg.side === "BUY");
  if (!sell || !buy) return "debit";
  if (first.right === "C") return sell.strike < buy.strike ? "call_credit" : "debit";
  return sell.strike > buy.strike ? "put_credit" : "debit";
}

export function isCreditStrategy(strategy: IpadStrategy, legs: readonly { side?: IpadSide }[]): boolean {
  if (strategy === "call_credit" || strategy === "put_credit") return true;
  if (strategy === "debit") return false;
  return legs[0]?.side === "SELL";
}

export function naturalNet(legs: readonly IpadStagedLeg[], strategy: IpadStrategy): number {
  if (legs.length === 0) return 0.05;
  if (strategy === "single" || legs.length === 1) return roundNickel(Math.max(0.05, legs[0]?.price ?? 0.05));
  const buy = legs.filter((leg) => leg.side === "BUY").reduce((sum, leg) => sum + leg.price, 0);
  const sell = legs.filter((leg) => leg.side === "SELL").reduce((sum, leg) => sum + leg.price, 0);
  const raw = strategy === "call_credit" || strategy === "put_credit" ? sell - buy : buy - sell;
  return roundNickel(Math.max(0.05, raw));
}

export function stepLimit(limit: number, dir: -1 | 1): number {
  const nickels = Math.round(limit * 20) + dir;
  return Math.max(0.05, nickels / 20);
}

export function stepQty(qty: number, dir: -1 | 1): number {
  return Math.min(25, Math.max(1, qty + dir));
}

/**
 * Credit TP is half the limit (floor $0.05) and SL is 2x.
 * Debit TP is 1.5x and SL is half (floor $0.05).
 * Cash is limit × 100 × qty. Credit-spread max risk is the width left after credit.
 */
export function ticketEconomics(
  strategy: IpadStrategy,
  legs: readonly { strike: number; side?: IpadSide }[],
  limit: number,
  qty: number,
): BracketEconomics {
  const credit = isCreditStrategy(strategy, legs);
  const tp = credit ? Math.max(0.05, limit * 0.5) : limit * 1.5;
  const sl = credit ? limit * 2 : Math.max(0.05, limit * 0.5);
  const cash = Math.round(limit * 100 * qty);
  let maxRisk = cash;
  if ((strategy === "call_credit" || strategy === "put_credit") && legs.length === 2) {
    const width = Math.abs(legs[0]!.strike - legs[1]!.strike);
    maxRisk = Math.max(0, Math.round((width - limit) * 100 * qty));
  }
  return {
    credit,
    tp: Number(tp.toFixed(2)),
    sl: Number(sl.toFixed(2)),
    cash,
    maxRisk,
  };
}

export function strategyLabel(strategy: IpadStrategy): string {
  switch (strategy) {
    case "call_credit":
      return "CALL CREDIT";
    case "put_credit":
      return "PUT CREDIT";
    case "debit":
      return "DEBIT";
    case "single":
      return "SINGLE";
  }
}

export function formatSendLabel(strategy: IpadStrategy, qty: number, limit: number, credit: boolean): string {
  return `SEND ${strategyLabel(strategy)} · ${qty}x @ $${limit.toFixed(2)} ${credit ? "CR" : "DR"}`;
}

export interface LadderTap {
  strike: number;
  right: IpadStagedLeg["right"];
  side: IpadSide;
  price: number;
}

/** BID stages SELL, ASK stages BUY. Same cell removes. Opposite side flips. Third leg drops the oldest. */
export function applyLadderTap(legs: readonly IpadStagedLeg[], tap: LadderTap): IpadStagedLeg[] {
  const same = legs.findIndex((leg) => leg.strike === tap.strike && leg.right === tap.right && leg.side === tap.side);
  if (same >= 0) return legs.filter((_, index) => index !== same);
  const opposite = legs.findIndex((leg) => leg.strike === tap.strike && leg.right === tap.right);
  if (opposite >= 0) {
    return legs.map((leg, index) =>
      index === opposite ? { ...leg, side: tap.side, price: tap.price, id: legId({ ...leg, side: tap.side }) } : leg,
    );
  }
  const added: IpadStagedLeg = {
    id: legId(tap),
    side: tap.side,
    right: tap.right,
    strike: tap.strike,
    price: tap.price,
  };
  const next = [...legs, added];
  if (next.length > 2) next.shift();
  return next;
}

export function legsFromPreset(
  priceOf: (leg: IpadPresetLeg) => number,
  preset: readonly IpadPresetLeg[],
): IpadStagedLeg[] {
  return preset.map((leg) => ({
    id: legId(leg),
    side: leg.side,
    right: leg.right,
    strike: leg.strike,
    price: priceOf(leg),
  }));
}
