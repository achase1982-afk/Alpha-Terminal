import { describe, expect, it } from "vitest";
import { computeOrderEconomics } from "../orderEconomics.js";
import { analyzeExpirationPayoff, dollarRightTailSlope, type PayoffLeg } from "../expirationPayoff.js";
import { parseCanonicalLimit } from "../optionTickRound.js";
import { resolvePairedBidAsk } from "../optionQuotes.js";

const spx = { underlyingSymbol: "SPX", isOption: true as const };

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
    expect(e?.buyingPowerEffect).toBeLessThan(0);
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

  it("covered call: flat dollar tail slope (long shares + short call)", () => {
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
    expect(dollarRightTailSlope(legs, 1)).toBe(0);
    const payoff = analyzeExpirationPayoff({
      legs,
      netPerShare: 2,
      spreadUnits: 1,
      isCredit: true,
      isOption: true,
    });
    expect(payoff.maxProfit).not.toBe(Number.POSITIVE_INFINITY);
  });

  it("limit parser rejects trailing junk on the full input string", () => {
    expect(parseCanonicalLimit("2.55abc", spx)).toBeNull();
    expect(parseCanonicalLimit("2.55", spx)).toBeCloseTo(2.55, 5);
  });
});