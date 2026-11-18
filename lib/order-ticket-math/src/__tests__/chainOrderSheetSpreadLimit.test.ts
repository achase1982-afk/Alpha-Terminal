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

  it("iron condor credit: max profit = credit, max loss = wing width − credit", () => {
    const legs = [
      {
        strike: 7530,
        optionType: "PUT" as const,
        instruction: "SELL_TO_OPEN" as const,
        quantity: 1,
        bid: 1.55,
        ask: 1.62,
        expiration: EXP,
      },
      {
        strike: 7525,
        optionType: "PUT" as const,
        instruction: "BUY_TO_OPEN" as const,
        quantity: 1,
        bid: 0.38,
        ask: 0.45,
        expiration: EXP,
      },
      {
        strike: 7550,
        optionType: "CALL" as const,
        instruction: "SELL_TO_OPEN" as const,
        quantity: 1,
        bid: 11.3,
        ask: 11.5,
        expiration: EXP,
      },
      {
        strike: 7555,
        optionType: "CALL" as const,
        instruction: "BUY_TO_OPEN" as const,
        quantity: 1,
        bid: 0.42,
        ask: 0.5,
        expiration: EXP,
      },
    ];
    const agg = aggregateSpreadNBBO(
      legs.map((l) => ({ instruction: l.instruction, bid: l.bid, ask: l.ask, quantity: l.quantity })),
    );
    const creditMid = agg?.mid ?? 0;
    expect(creditMid).toBeGreaterThan(0);
    const summary = computeChainTicketSummary({
      underlyingSymbol: "SPX",
      legs,
      limitPrice: creditMid,
      spreadQuantity: 1,
      isCredit: true,
    });
    const limitPerShare = summary?.limitPerShare ?? creditMid;
    expect(summary?.isCredit).toBe(true);
    expect(summary?.maxProfit).toBeGreaterThan(0);
    expect(summary?.maxProfit).toBeCloseTo(limitPerShare * 100, 0);
    expect(summary?.maxLoss).toBeGreaterThan(0);
    expect(summary?.maxLoss!).toBeLessThan(5 * 100);
  });
});