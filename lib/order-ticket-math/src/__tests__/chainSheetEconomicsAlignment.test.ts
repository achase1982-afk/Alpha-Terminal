import { describe, expect, it } from "vitest";
import { computeChainTicketSummary } from "../chainTicketSummary.js";
import { computeOrderEconomics } from "../orderEconomics.js";

const SPX = "SPX";

describe("chain sheet summary vs confirm economics", () => {
  function bearCallCredit290() {
    const legs = [
      {
        strike: 600,
        optionType: "CALL" as const,
        instruction: "SELL_TO_OPEN",
        quantity: 1,
        bid: 2.85,
        ask: 2.92,
        expiration: "2026-12-19",
      },
      {
        strike: 605,
        optionType: "CALL" as const,
        instruction: "BUY_TO_OPEN",
        quantity: 1,
        bid: 1.1,
        ask: 1.15,
        expiration: "2026-12-19",
      },
    ];
    const summary = computeChainTicketSummary({
      underlyingSymbol: SPX,
      legs,
      limitPrice: 2.9,
      spreadQuantity: 1,
      isCredit: true,
    });
    const confirm = computeOrderEconomics({
      underlyingSymbol: SPX,
      isOption: true,
      legs: legs.map(({ strike, optionType, instruction, quantity, expiration }) => ({
        strike,
        optionType,
        instruction,
        expiration,
        quantity,
      })),
      limitPrice: 2.9,
      quantity: 1,
      isCredit: true,
      contractCount: 2,
    });
    return { summary, confirm };
  }

  it("credit vertical: summary BP matches confirm BP", () => {
    const { summary, confirm } = bearCallCredit290();
    expect(summary?.buyingPowerEffect).toBe(-210);
    expect(summary?.buyingPowerEffect).toBe(confirm?.buyingPowerEffect);
    expect(summary?.maxLoss).toBe(confirm?.maxRisk);
  });

  it("debit vertical: summary BP matches confirm BP", () => {
    const legs = [
      {
        strike: 600,
        optionType: "CALL" as const,
        instruction: "BUY_TO_OPEN",
        quantity: 1,
        bid: 3.1,
        ask: 3.2,
        expiration: "2026-12-19",
      },
      {
        strike: 605,
        optionType: "CALL" as const,
        instruction: "SELL_TO_OPEN",
        quantity: 1,
        bid: 1.1,
        ask: 1.15,
        expiration: "2026-12-19",
      },
    ];
    const summary = computeChainTicketSummary({
      underlyingSymbol: SPX,
      legs,
      limitPrice: 2.0,
      spreadQuantity: 1,
      isCredit: false,
    });
    const confirm = computeOrderEconomics({
      underlyingSymbol: SPX,
      isOption: true,
      legs: legs.map(({ strike, optionType, instruction, quantity, expiration }) => ({
        strike,
        optionType,
        instruction,
        expiration,
        quantity,
      })),
      limitPrice: 2.0,
      quantity: 1,
      isCredit: false,
      contractCount: 2,
    });
    expect(summary?.buyingPowerEffect).toBe(confirm?.buyingPowerEffect);
  });
});