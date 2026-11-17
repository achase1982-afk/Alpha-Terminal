import { describe, expect, it } from "vitest";
import { computeOrderEconomics } from "../orderEconomics.js";
import {
  analyzeExpirationPayoff,
  payoffDollarsAtS,
  type ExpirationPayoffInput,
  type PayoffLeg,
} from "../expirationPayoff.js";
import { parseCanonicalLimit } from "../optionTickRound.js";
import { resolvePairedBidAsk } from "../optionQuotes.js";

const spx = { underlyingSymbol: "SPX", isOption: true as const };

function bruteMaxProfit(input: ExpirationPayoffInput): number {
  const strikes = input.legs
    .filter((l) => l.optionType === "CALL" || l.optionType === "PUT")
    .map((l) => l.strike);
  const hi = strikes.length ? Math.max(...strikes, 0) + 50 : 80;
  let maxP = -Infinity;
  for (let s = 0; s <= hi; s += 0.25) {
    maxP = Math.max(maxP, payoffDollarsAtS(input, s));
  }
  return maxP;
}

describe("QA reviewer fixes", () => {
  it("calendar (multi-expiry): withhold expiration payoff metrics", () => {
    const e = computeOrderEconomics({
      ...spx,
      legs: [
        {
          strike: 5900,
          optionType: "CALL",
          instruction: "SELL_TO_OPEN",
          expiration: "2026-01-17",
          quantity: 1,
        },
        {
          strike: 5900,
          optionType: "CALL",
          instruction: "BUY_TO_OPEN",
          expiration: "2026-02-21",
          quantity: 1,
        },
      ],
      limitPrice: 0.85,
      quantity: 1,
      isCredit: true,
    });
    expect(e?.expirationPayoffModeled).toBe(false);
    expect(e?.breakevens).toEqual([]);
    expect(e?.maxRisk).toBeNull();
    expect(e?.maxProfit).toBeNull();
  });

  it("defined-risk credit: BP effect is negative max loss, not premium credit", () => {
    const e = computeOrderEconomics({
      ...spx,
      legs: [
        { strike: 5895, optionType: "PUT", instruction: "SELL_TO_OPEN", quantity: 1 },
        { strike: 5890, optionType: "PUT", instruction: "BUY_TO_OPEN", quantity: 1 },
      ],
      limitPrice: 1,
      quantity: 1,
      isCredit: true,
    });
    expect(e?.maxRisk).toBe(400);
    expect(e?.buyingPowerEffect).toBe(-400);
    expect(e?.netCashFlow).toBeGreaterThan(0);
  });

  it("quotes: resolvePairedBidAsk never mixes partial stream + contract legs", () => {
    const pair = resolvePairedBidAsk({
      streamBid: 2.4,
      streamAsk: undefined,
      contractBid: 1.1,
      contractAsk: 1.2,
    });
    expect(pair?.source).toBe("contract");
    expect(pair?.bid).toBe(1.1);
    expect(pair?.ask).toBe(1.2);
  });

  it("covered call: engine max profit matches brute-force scan (no tail helper)", () => {
    const legs: PayoffLeg[] = [
      {
        strike: 0,
        optionType: "EQUITY",
        instruction: "BUY",
        quantity: 100,
        assetType: "EQUITY",
      },
      {
        strike: 150,
        optionType: "CALL",
        instruction: "SELL_TO_OPEN",
        quantity: 1,
      },
    ];
    const input: ExpirationPayoffInput = {
      legs,
      netPerShare: 2,
      spreadUnits: 1,
      isCredit: true,
      isOption: true,
    };
    const engine = analyzeExpirationPayoff(input);
    const brute = bruteMaxProfit(input);
    expect(engine.maxProfit).toBeCloseTo(brute, 4);
    expect(engine.maxProfit).not.toBe(Number.POSITIVE_INFINITY);
  });

  it("collar: finite max profit and loss", () => {
    const legs: PayoffLeg[] = [
      { strike: 0, optionType: "EQUITY", instruction: "BUY", quantity: 100, assetType: "EQUITY" },
      { strike: 140, optionType: "PUT", instruction: "BUY_TO_OPEN", quantity: 1 },
      { strike: 160, optionType: "CALL", instruction: "SELL_TO_OPEN", quantity: 1 },
    ];
    const input: ExpirationPayoffInput = {
      legs,
      netPerShare: 0.5,
      spreadUnits: 1,
      isCredit: false,
      isOption: true,
    };
    const engine = analyzeExpirationPayoff(input);
    const brute = bruteMaxProfit(input);
    expect(engine.maxProfit).toBeCloseTo(brute, 4);
    expect(engine.maxLoss).not.toBeNull();
  });

  it("limit parser accepts and rejects expected forms", () => {
    expect(parseCanonicalLimit(".55", spx)).toBeCloseTo(0.55, 5);
    expect(parseCanonicalLimit("2.", spx)).toBeCloseTo(2, 5);
    expect(parseCanonicalLimit("0.55", spx)).toBeCloseTo(0.55, 5);
    expect(parseCanonicalLimit("2.55abc", spx)).toBeNull();
    expect(parseCanonicalLimit("1e2", spx)).toBeNull();
    expect(parseCanonicalLimit("-1", spx)).toBeNull();
    expect(parseCanonicalLimit("1,000", spx)).toBeNull();
  });
});