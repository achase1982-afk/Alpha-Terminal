import { describe, expect, it } from "vitest";
import {
  computeChainTicketSummary,
  referenceBruteForcePayoff,
} from "../chainTicketSummary.js";
import { analyzeExpirationPayoff } from "../expirationPayoff.js";

const SPX = "SPX";

function summaryMid(
  legs: Array<{
    strike: number;
    optionType: "CALL" | "PUT";
    instruction: string;
    quantity?: number;
    bid: number;
    ask: number;
  }>,
  net: number,
  qty = 1,
  isCredit?: boolean,
) {
  return computeChainTicketSummary({
    underlyingSymbol: SPX,
    legs,
    limitPrice: net,
    spreadQuantity: qty,
    isCredit,
  });
}

describe("chain ticket summary vs brute-force payoff", () => {
  it("put credit vertical: max loss/profit match payoff engine", () => {
    const legs = [
      {
        strike: 5895,
        optionType: "PUT" as const,
        instruction: "SELL_TO_OPEN",
        quantity: 1,
        bid: 2.5,
        ask: 2.55,
      },
      {
        strike: 5890,
        optionType: "PUT" as const,
        instruction: "BUY_TO_OPEN",
        quantity: 1,
        bid: 1.45,
        ask: 1.5,
      },
    ];
    const s = summaryMid(legs, 1.0, 1, true);
    expect(s?.maxProfit).toBe(100);
    expect(s?.maxLoss).toBe(400);
    const input = {
      legs: legs.map(({ strike, optionType, instruction, quantity }) => ({
        strike,
        optionType,
        instruction,
        quantity,
      })),
      netPerShare: 1,
      spreadUnits: 1,
      isCredit: true,
      isOption: true as const,
    };
    const ref = referenceBruteForcePayoff(input);
    const engine = analyzeExpirationPayoff(input);
    expect(s?.maxLoss).toBeCloseTo(ref.maxLoss ?? 0, 4);
    expect(s?.maxProfit).toBeCloseTo(ref.maxProfit, 4);
    expect(engine.breakevens[0]).toBeCloseTo(s?.breakevens[0] ?? 0, 4);
  });

  it("iron condor: POP from lognormal between breakevens (not delta proxy)", () => {
    const legs = [
      { strike: 7525, optionType: "PUT" as const, instruction: "BUY_TO_OPEN", quantity: 1, bid: 0.4, ask: 0.45, iv: 0.18, expiration: "2026-11-17" },
      { strike: 7530, optionType: "PUT" as const, instruction: "SELL_TO_OPEN", quantity: 1, bid: 1.55, ask: 1.62, iv: 0.18, expiration: "2026-11-17" },
      { strike: 7550, optionType: "CALL" as const, instruction: "SELL_TO_OPEN", quantity: 1, bid: 1.35, ask: 1.42, iv: 0.18, expiration: "2026-11-17" },
      { strike: 7555, optionType: "CALL" as const, instruction: "BUY_TO_OPEN", quantity: 1, bid: 0.45, ask: 0.5, iv: 0.18, expiration: "2026-11-17" },
    ];
    const asOf = Date.UTC(2026, 10, 17, 15, 0, 0);
    const s = computeChainTicketSummary({
      underlyingSymbol: SPX,
      legs,
      limitPrice: 2.05,
      spreadQuantity: 1,
      isCredit: true,
      spotPrice: 7540,
      asOfMs: asOf,
    });
    expect(s?.pop).not.toBeNull();
    expect(s!.pop!).toBeGreaterThan(5);
    expect(s!.pop!).toBeLessThan(45);
    expect(s!.breakevens).toHaveLength(2);
  });

  it("iron condor: bounded max loss", () => {
    const legs = [
      { strike: 5880, optionType: "PUT" as const, instruction: "BUY_TO_OPEN", quantity: 1, bid: 0.9, ask: 0.95 },
      { strike: 5890, optionType: "PUT" as const, instruction: "SELL_TO_OPEN", quantity: 1, bid: 1.9, ask: 1.95 },
      { strike: 5910, optionType: "CALL" as const, instruction: "SELL_TO_OPEN", quantity: 1, bid: 1.8, ask: 1.85 },
      { strike: 5920, optionType: "CALL" as const, instruction: "BUY_TO_OPEN", quantity: 1, bid: 0.85, ask: 0.9 },
    ];
    const s = summaryMid(legs, 1.0, 1, true);
    const input = {
      legs: legs.map(({ strike, optionType, instruction, quantity }) => ({
        strike,
        optionType,
        instruction,
        quantity,
      })),
      netPerShare: 1,
      spreadUnits: 1,
      isCredit: true,
      isOption: true as const,
    };
    const ref = referenceBruteForcePayoff(input);
    expect(s?.maxLoss).toBeCloseTo(ref.maxLoss ?? 0, 4);
    expect(s?.maxProfit).toBeCloseTo(ref.maxProfit, 4);
  });

  it("1:2:1 call butterfly debit", () => {
    const legs = [
      { strike: 5900, optionType: "CALL" as const, instruction: "BUY_TO_OPEN", quantity: 1, bid: 8, ask: 8.1 },
      { strike: 5905, optionType: "CALL" as const, instruction: "SELL_TO_OPEN", quantity: 2, bid: 5, ask: 5.1 },
      { strike: 5910, optionType: "CALL" as const, instruction: "BUY_TO_OPEN", quantity: 1, bid: 2.8, ask: 2.9 },
    ];
    const s = summaryMid(legs, 1.0, 1, false);
    const input = {
      legs: legs.map(({ strike, optionType, instruction, quantity }) => ({
        strike,
        optionType,
        instruction,
        quantity,
      })),
      netPerShare: 1,
      spreadUnits: 1,
      isCredit: false,
      isOption: true as const,
    };
    const ref = referenceBruteForcePayoff(input);
    const engine = analyzeExpirationPayoff(input);
    expect(s?.maxLoss).toBeCloseTo(ref.maxLoss ?? 0, 4);
    expect(s?.maxProfit).toBeCloseTo(Math.min(ref.maxProfit, engine.maxProfit), 4);
  });

  it("mixed-quantity ratio spread (1:2 vertical)", () => {
    const legs = [
      { strike: 5900, optionType: "CALL" as const, instruction: "BUY_TO_OPEN", quantity: 1, bid: 3.7, ask: 3.8 },
      { strike: 5910, optionType: "CALL" as const, instruction: "SELL_TO_OPEN", quantity: 2, bid: 1.2, ask: 1.25 },
    ];
    const s = summaryMid(legs, 1.5, 1, false);
    expect(s?.spreadMid).not.toBeNull();
    const input = {
      legs: legs.map(({ strike, optionType, instruction, quantity }) => ({
        strike,
        optionType,
        instruction,
        quantity,
      })),
      netPerShare: 1.5,
      spreadUnits: 1,
      isCredit: false,
      isOption: true as const,
    };
    const ref = referenceBruteForcePayoff(input);
    expect(s?.maxLoss).toBeCloseTo(ref.maxLoss ?? 0, 3);
  });
});