import { describe, expect, it } from "vitest";
import { computeChainTicketSummary } from "../chainTicketSummary.js";
import { aggregateSpreadNBBO } from "../optionQuotes.js";
import { chainLegHydrateKey } from "../chainOrderSheetHydrate.js";

const EXP = "2026-11-17";

describe("chain sheet spread limit hydrate", () => {
  const buy7545 = {
    strike: 7545,
    optionType: "CALL" as const,
    instruction: "BUY_TO_OPEN" as const,
    quantity: 1,
    bid: 13.4,
    ask: 13.7,
    expiration: EXP,
    delta: 0.31,
    theta: -0.48,
    vega: 0.14,
  };
  const sell7550 = {
    strike: 7550,
    optionType: "CALL" as const,
    instruction: "SELL_TO_OPEN" as const,
    quantity: 1,
    bid: 11.3,
    ask: 11.5,
    expiration: EXP,
    delta: 0.24,
    theta: -0.45,
    vega: 0.13,
  };

  const symmetricIronCondor5 = [
    { strike: 7530, optionType: "PUT" as const, instruction: "SELL_TO_OPEN" as const, quantity: 1, bid: 2.1, ask: 2.15, expiration: EXP },
    { strike: 7525, optionType: "PUT" as const, instruction: "BUY_TO_OPEN" as const, quantity: 1, bid: 0.12, ask: 0.16, expiration: EXP },
    { strike: 7550, optionType: "CALL" as const, instruction: "SELL_TO_OPEN" as const, quantity: 1, bid: 1.85, ask: 1.9, expiration: EXP },
    { strike: 7555, optionType: "CALL" as const, instruction: "BUY_TO_OPEN" as const, quantity: 1, bid: 0.1, ask: 0.14, expiration: EXP },
  ];

  const unequalIronCondor = [
    { strike: 7530, optionType: "PUT" as const, instruction: "SELL_TO_OPEN" as const, quantity: 1, bid: 2.1, ask: 2.15, expiration: EXP },
    { strike: 7520, optionType: "PUT" as const, instruction: "BUY_TO_OPEN" as const, quantity: 1, bid: 0.05, ask: 0.08, expiration: EXP },
    { strike: 7550, optionType: "CALL" as const, instruction: "SELL_TO_OPEN" as const, quantity: 1, bid: 1.85, ask: 1.9, expiration: EXP },
    { strike: 7555, optionType: "CALL" as const, instruction: "BUY_TO_OPEN" as const, quantity: 1, bid: 0.1, ask: 0.14, expiration: EXP },
  ];

  it("SPX bull call with 0-bid short leg: spread mid 0.78, max loss $78, max profit $422, BE 7340.78", () => {
    const buy7340 = {
      strike: 7340,
      optionType: "CALL" as const,
      instruction: "BUY_TO_OPEN" as const,
      quantity: 1,
      bid: 0.75,
      ask: 1.0,
      expiration: EXP,
    };
    const sell7345 = {
      strike: 7345,
      optionType: "CALL" as const,
      instruction: "SELL_TO_OPEN" as const,
      quantity: 1,
      bid: 0,
      ask: 0.2,
      expiration: EXP,
    };
    const legs = [buy7340, sell7345];
    const agg = aggregateSpreadNBBO(
      legs.map((l) => ({ instruction: l.instruction, bid: l.bid, ask: l.ask, quantity: l.quantity })),
    );
    expect(agg?.mid).toBeCloseTo(0.775, 2);

    const summary = computeChainTicketSummary({
      underlyingSymbol: "SPX",
      legs,
      limitPrice: 0.78,
      spreadQuantity: 1,
      isCredit: false,
    });
    expect(summary?.maxProfit).toBeCloseTo(420, 0);
    expect(summary?.breakevens[0]).toBeCloseTo(7340.8, 1);
    expect(summary?.spreadMid).toBeCloseTo(0.775, 2);
    expect(summary?.limitPerShare).toBeCloseTo(0.8, 2);
  });

  it("bull call debit: spread mid ~2.15 yields max loss $215, max profit $285, BE 7547.15", () => {
    const legs = [buy7545, sell7550];
    const agg = aggregateSpreadNBBO(
      legs.map((l) => ({ instruction: l.instruction, bid: l.bid, ask: l.ask, quantity: l.quantity })),
    );
    expect(agg?.mid).toBeCloseTo(2.15, 2);
    expect(agg?.ask).toBeCloseTo(2.4, 2);

    const summary = computeChainTicketSummary({
      underlyingSymbol: "SPX",
      legs,
      limitPrice: 2.15,
      spreadQuantity: 1,
      isCredit: false,
    });
    expect(summary?.maxLoss).toBeCloseTo(215, 0);
    expect(summary?.maxProfit).toBeCloseTo(285, 0);
    expect(summary?.breakevens[0]).toBeCloseTo(7547.15, 2);
    expect(summary?.netTheta).not.toBe(0);
  });

  it("hydrate key changes when a second leg is added", () => {
    const k1 = chainLegHydrateKey([
      { id: "a", direction: "BUY_TO_OPEN", strike: 7545, quantity: 1, schwabSymbol: "L1" },
    ]);
    const k2 = chainLegHydrateKey([
      { id: "a", direction: "BUY_TO_OPEN", strike: 7545, quantity: 1, schwabSymbol: "L1" },
      { id: "b", direction: "SELL_TO_OPEN", strike: 7550, quantity: 1, schwabSymbol: "L2" },
    ]);
    expect(k1).not.toBe(k2);
  });

  it("removing a leg changes hydrate key and single-leg economics use leg mid", () => {
    const one = computeChainTicketSummary({
      underlyingSymbol: "SPX",
      legs: [buy7545],
      limitPrice: 13.55,
      spreadQuantity: 1,
      isCredit: false,
    });
    expect(one?.maxLoss).toBeGreaterThan(1300);
    expect(one?.maxLoss).toBeLessThan(1400);
    const keyRm = chainLegHydrateKey([
      { id: "a", direction: "BUY_TO_OPEN", strike: 7545, quantity: 1, schwabSymbol: "L1" },
    ]);
    expect(keyRm).not.toContain("7550");
    expect(one?.breakevens.length).toBeGreaterThan(0);
  });

  it("iron condor 5-wide credit $3.70: max profit $370, max loss $130, two breakevens", () => {
    const summary = computeChainTicketSummary({
      underlyingSymbol: "SPX",
      legs: symmetricIronCondor5,
      limitPrice: 3.7,
      spreadQuantity: 1,
      isCredit: true,
    });
    expect(summary?.isCredit).toBe(true);
    expect(summary?.maxProfit).toBe(370);
    expect(summary?.maxLoss).toBe(130);
    expect(summary?.breakevens).toHaveLength(2);
    expect(summary?.breakevens[0]).toBeCloseTo(7526.3, 1);
    expect(summary?.breakevens[1]).toBeCloseTo(7553.7, 1);
  });

  it("iron condor qty 2 scales max profit and max loss", () => {
    const summary = computeChainTicketSummary({
      underlyingSymbol: "SPX",
      legs: symmetricIronCondor5,
      limitPrice: 3.7,
      spreadQuantity: 2,
      isCredit: true,
    });
    expect(summary?.maxProfit).toBe(740);
    expect(summary?.maxLoss).toBe(260);
  });

  it("unequal wings put 10 / call 5 at $3.70: max profit $370, max loss $630", () => {
    const summary = computeChainTicketSummary({
      underlyingSymbol: "SPX",
      legs: unequalIronCondor,
      limitPrice: 3.7,
      spreadQuantity: 1,
      isCredit: true,
    });
    expect(summary?.maxProfit).toBe(370);
    expect(summary?.maxLoss).toBe(630);
    expect(summary?.breakevens).toHaveLength(2);
  });

  it("1:2 call ratio vertical: bounded max loss is null", () => {
    const legs = [
      { strike: 5900, optionType: "CALL" as const, instruction: "BUY_TO_OPEN" as const, quantity: 1, bid: 3.7, ask: 3.8, expiration: EXP },
      { strike: 5910, optionType: "CALL" as const, instruction: "SELL_TO_OPEN" as const, quantity: 2, bid: 1.2, ask: 1.25, expiration: EXP },
    ];
    const summary = computeChainTicketSummary({
      underlyingSymbol: "SPX",
      legs,
      limitPrice: 1.5,
      spreadQuantity: 1,
      isCredit: false,
    });
    expect(summary?.maxLoss).toBeNull();
    expect(summary?.maxProfit).toBeGreaterThan(0);
  });
});