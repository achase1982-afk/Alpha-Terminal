import { roundNickel } from "./format";
import type { IpadLadderQuote, IpadPresetLeg, IpadTick } from "./types";

export const LADDER_HIGH = 7350;
export const LADDER_LOW = 7210;

export function fullStrikes(): number[] {
  const strikes: number[] = [];
  for (let strike = LADDER_HIGH; strike >= LADDER_LOW; strike -= 5) strikes.push(strike);
  return strikes;
}

/** 10pt mode keeps multiples of 10 plus walls, ATM, and staged strikes. */
export function visibleStrikes(step: 5 | 10, preserve: readonly number[]): number[] {
  const all = fullStrikes();
  if (step === 5) return all;
  const keep = new Set(preserve);
  return all.filter((strike) => strike % 10 === 0 || keep.has(strike));
}

export function strikeAboveSpot(strikes: readonly number[], spot: number): number | null {
  let above: number | null = null;
  for (const strike of strikes) {
    if (strike > spot && (above == null || strike < above)) above = strike;
  }
  return above;
}

export function railVisibility(input: {
  callWallTop: number;
  callWallHeight: number;
  gammaTop: number;
  scrollTop: number;
  clientHeight: number;
}): { top: boolean; bottom: boolean } {
  return {
    top: input.callWallTop + input.callWallHeight - 6 < input.scrollTop,
    bottom: input.gammaTop + 6 > input.scrollTop + input.clientHeight,
  };
}

export interface BookSpec {
  spot: number;
  /** Ascending strike → call mid. Must be strictly decreasing in price. */
  callKnots: ReadonlyArray<readonly [number, number]>;
  /** Ascending strike → put mid. Must be strictly increasing in price. */
  putKnots: ReadonlyArray<readonly [number, number]>;
  callWall: number;
  putWall: number;
}

function interp(knots: ReadonlyArray<readonly [number, number]>, strike: number): number {
  const first = knots[0];
  const last = knots[knots.length - 1];
  if (!first || !last) return 0.3;
  if (strike <= first[0]) return first[1];
  if (strike >= last[0]) return last[1];
  for (let i = 1; i < knots.length; i++) {
    const right = knots[i]!;
    const left = knots[i - 1]!;
    if (strike <= right[0]) {
      const span = right[0] - left[0];
      const t = span === 0 ? 0 : (strike - left[0]) / span;
      return left[1] + t * (right[1] - left[1]);
    }
  }
  return last[1];
}

function bidAsk(mid: number): { bid: number; ask: number } {
  const nickel = Math.max(0.3, roundNickel(mid));
  return { bid: roundNickel(nickel - 0.15), ask: roundNickel(nickel + 0.15) };
}

function tickFor(strike: number, side: "call" | "put"): IpadTick {
  const up = (strike / 5) % 2 === 0;
  if (side === "call") return up ? "up" : "down";
  return up ? "down" : "up";
}

export function buildQuoteBook(spec: BookSpec): Map<number, IpadLadderQuote> {
  const book = new Map<number, IpadLadderQuote>();
  const ascending = [...fullStrikes()].reverse();
  let prevCall = Number.POSITIVE_INFINITY;
  let prevPut = 0;
  for (const strike of ascending) {
    let callMid = roundNickel(interp(spec.callKnots, strike));
    if (callMid >= prevCall) callMid = roundNickel(Math.max(0.3, prevCall - 0.05));
    prevCall = callMid;
    let putMid = roundNickel(interp(spec.putKnots, strike));
    if (putMid <= prevPut) putMid = roundNickel(prevPut + 0.05);
    prevPut = putMid;
    const call = bidAsk(callMid);
    const put = bidAsk(putMid);
    const dist = Math.abs(strike - spec.spot);
    const base = 1500 * Math.exp(-dist / 30);
    const callBoost = strike === spec.callWall ? 900 : 0;
    const putBoost = strike === spec.putWall ? 900 : 0;
    book.set(strike, {
      strike,
      callBid: call.bid,
      callAsk: call.ask,
      putBid: put.bid,
      putAsk: put.ask,
      callVol: Math.max(8, Math.round(base * (strike >= spec.spot ? 1.2 : 0.72) + callBoost)),
      putVol: Math.max(8, Math.round(base * (strike <= spec.spot ? 1.25 : 0.68) + putBoost)),
      callTick: tickFor(strike, "call"),
      putTick: tickFor(strike, "put"),
    });
  }
  return book;
}

export function quotePrice(quote: IpadLadderQuote, leg: Pick<IpadPresetLeg, "right" | "side">): number {
  if (leg.right === "C") return leg.side === "SELL" ? quote.callBid : quote.callAsk;
  return leg.side === "SELL" ? quote.putBid : quote.putAsk;
}

export function quoteMid(quote: IpadLadderQuote, right: IpadPresetLeg["right"]): number {
  return right === "C" ? (quote.callBid + quote.callAsk) / 2 : (quote.putBid + quote.putAsk) / 2;
}
