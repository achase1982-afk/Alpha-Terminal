import { describe, expect, it } from "vitest";
import { computeOrderEconomics } from "../orderEconomics.js";
import { analyzeExpirationPayoff } from "../expirationPayoff.js";
import { schwabOrderMaxRisk } from "../schwabOrderRisk.js";
import { evaluateServerPlaceOrderGate } from "../serverPlaceOrderGate.js";

const spx = { underlyingSymbol: "SPX", isOption: true as const };
const sym = (cp: "C" | "P", strike: number) =>
  `SPXW  261118${cp}${String(Math.round(strike * 1000)).padStart(8, "0")}`;

function putVertical(shortStrike: number, longStrike: number, credit: boolean, net: number) {
  return computeOrderEconomics({
    ...spx,
    legs: credit
      ? [
          { strike: shortStrike, optionType: "PUT", instruction: "SELL_TO_OPEN", quantity: 1 },
          { strike: longStrike, optionType: "PUT", instruction: "BUY_TO_OPEN", quantity: 1 },
        ]
      : [
          { strike: shortStrike, optionType: "PUT", instruction: "BUY_TO_OPEN", quantity: 1 },
          { strike: longStrike, optionType: "PUT", instruction: "SELL_TO_OPEN", quantity: 1 },
        ],
    limitPrice: net,
    quantity: 1,
    isCredit: credit,
  });
}

function callVertical(buyStrike: number, sellStrike: number, debit: boolean, net: number) {
  return computeOrderEconomics({
    ...spx,
    legs: debit
      ? [
          { strike: buyStrike, optionType: "CALL", instruction: "BUY_TO_OPEN", quantity: 1 },
          { strike: sellStrike, optionType: "CALL", instruction: "SELL_TO_OPEN", quantity: 1 },
        ]
      : [
          { strike: buyStrike, optionType: "CALL", instruction: "SELL_TO_OPEN", quantity: 1 },
          { strike: sellStrike, optionType: "CALL", instruction: "BUY_TO_OPEN", quantity: 1 },
        ],
    limitPrice: net,
    quantity: 1,
    isCredit: !debit,
  });
}

describe("expiration payoff engine", () => {
  it("5-wide put credit at 1.00: maxLoss 400, maxProfit 100", () => {
    const e = putVertical(5895, 5890, true, 1);
    expect(e?.maxRisk).toBe(400);
    expect(e?.maxProfit).toBe(100);
  });

  it("SPX 5900/5890 put credit at 2.55: maxProfit 255", () => {
    const e = putVertical(5900, 5890, true, 2.55);
    expect(e?.maxProfit).toBe(255);
  });

  it("bull call 5900/5910 at 2.55: BE 5902.55", () => {
    const e = callVertical(5900, 5910, true, 2.55);
    expect(e?.breakevens[0]).toBeCloseTo(5902.55, 5);
  });

  it("bear put 5910/5900 at 2.55: BE 5907.45", () => {
    const e = putVertical(5910, 5900, true, 2.55);
    expect(e?.breakevens[0]).toBeCloseTo(5907.45, 5);
  });

  it("call fly 500/510x2/515 debit 1: maxLoss 100", () => {
    const e = computeOrderEconomics({
      ...spx,
      legs: [
        { strike: 500, optionType: "CALL", instruction: "BUY_TO_OPEN", quantity: 1 },
        { strike: 510, optionType: "CALL", instruction: "SELL_TO_OPEN", quantity: 2 },
        { strike: 515, optionType: "CALL", instruction: "BUY_TO_OPEN", quantity: 1 },
      ],
      limitPrice: 1,
      quantity: 1,
      isCredit: false,
    });
    expect(e?.maxRisk).toBe(100);
  });

  it("debit vertical LIMIT 1.00 5-wide: maxLoss 100", () => {
    const e = callVertical(5900, 5905, true, 1);
    expect(e?.maxRisk).toBe(100);
  });

  it("ITM credit 4.00 5-wide: maxLoss 100", () => {
    const e = callVertical(5900, 5905, false, 4);
    expect(e?.maxRisk).toBe(100);
  });

  it("long strangle as LIMIT: the debit paid", () => {
    const risk = schwabOrderMaxRisk({
      orderType: "LIMIT",
      price: 3,
      orderLegCollection: [
        { instruction: "BUY_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: sym("C", 5950) } },
        { instruction: "BUY_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: sym("P", 5850) } },
      ],
    });
    expect(risk.kind).toBe("known");
    if (risk.kind === "known") expect(risk.maxRisk).toBe(300);
  });

  it("short put + long call credit 0.50: unknown, not RED", () => {
    const order = {
      orderType: "NET_CREDIT",
      price: 0.5,
      orderLegCollection: [
        { instruction: "SELL_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: sym("P", 5900) } },
        { instruction: "BUY_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: sym("C", 5950) } },
      ],
    };
    expect(schwabOrderMaxRisk(order).kind).toBe("unknown");
    const gate = evaluateServerPlaceOrderGate({ order, accountEquity: 30_000 });
    expect(gate.checks.find((c: { id: string }) => c.id === "size")?.level).not.toBe("RED");
  });

  it("long call + 2 short calls: unbounded max loss", () => {
    const e = analyzeExpirationPayoff({
      legs: [
        { strike: 100, optionType: "CALL", instruction: "BUY_TO_OPEN", quantity: 1 },
        { strike: 105, optionType: "CALL", instruction: "SELL_TO_OPEN", quantity: 2 },
      ],
      netPerShare: 1,
      spreadUnits: 1,
      isCredit: false,
      isOption: true,
    });
    expect(e.maxLoss).toBeNull();
  });

  it("two long calls: unbounded max profit", () => {
    const e = analyzeExpirationPayoff({
      legs: [
        { strike: 100, optionType: "CALL", instruction: "BUY_TO_OPEN", quantity: 1 },
        { strike: 105, optionType: "CALL", instruction: "BUY_TO_OPEN", quantity: 1 },
      ],
      netPerShare: 2,
      spreadUnits: 1,
      isCredit: false,
      isOption: true,
    });
    expect(e.maxProfit).toBe(Number.POSITIVE_INFINITY);
  });
});
