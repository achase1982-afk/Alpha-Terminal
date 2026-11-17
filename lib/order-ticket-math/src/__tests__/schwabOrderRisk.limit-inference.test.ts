import { describe, expect, it } from "vitest";
import { evaluateServerPlaceOrderGate } from "../serverPlaceOrderGate.js";
import { schwabOrderMaxRisk, schwabOrderToEconomicsInput } from "../schwabOrderRisk.js";
import { computeOrderEconomics } from "../orderEconomics.js";
import { analyzeExpirationPayoff } from "../expirationPayoff.js";

const sym = (cp: "C" | "P", strike: number) =>
  `SPXW  261118${cp}${String(Math.round(strike * 1000)).padStart(8, "0")}`;

function limitOrder(legs: Array<{ ins: string; qty: number; sym: string }>, price: number) {
  return {
    orderType: "LIMIT",
    price,
    orderLegCollection: legs.map((l) => ({
      instruction: l.ins,
      quantity: l.qty,
      instrument: { assetType: "OPTION", symbol: l.sym },
    })),
  };
}

describe("LIMIT credit/debit inference", () => {
  it("put credit 500/495 at 1.00 maxLoss 400", () => {
    const o = limitOrder(
      [
        { ins: "SELL_TO_OPEN", qty: 1, sym: sym("P", 500) },
        { ins: "BUY_TO_OPEN", qty: 1, sym: sym("P", 495) },
      ],
      1,
    );
    const r = schwabOrderMaxRisk(o);
    expect(r.kind).toBe("known");
    if (r.kind === "known") expect(r.maxRisk).toBe(400);
  });

  it("ITM put credit at 4.00 maxLoss 100", () => {
    const o = limitOrder(
      [
        { ins: "SELL_TO_OPEN", qty: 1, sym: sym("P", 5950) },
        { ins: "BUY_TO_OPEN", qty: 1, sym: sym("P", 5945) },
      ],
      4,
    );
    const r = schwabOrderMaxRisk(o);
    if (r.kind === "known") expect(r.maxRisk).toBe(100);
  });

  it("bear put debit at 2.00 maxLoss 200", () => {
    const o = limitOrder(
      [
        { ins: "BUY_TO_OPEN", qty: 1, sym: sym("P", 5910) },
        { ins: "SELL_TO_OPEN", qty: 1, sym: sym("P", 5900) },
      ],
      2,
    );
    const r = schwabOrderMaxRisk(o);
    if (r.kind === "known") expect(r.maxRisk).toBe(200);
  });

  it("long IC debit at 4.00 maxLoss 400", () => {
    const o = limitOrder(
      [
        { ins: "BUY_TO_OPEN", qty: 1, sym: sym("P", 5900) },
        { ins: "SELL_TO_OPEN", qty: 1, sym: sym("P", 5895) },
        { ins: "SELL_TO_OPEN", qty: 1, sym: sym("C", 5950) },
        { ins: "BUY_TO_OPEN", qty: 1, sym: sym("C", 5955) },
      ],
      4,
    );
    const r = schwabOrderMaxRisk(o);
    if (r.kind === "known") expect(r.maxRisk).toBe(400);
  });

  it("long iron fly debit maxLoss 300", () => {
    const o = limitOrder(
      [
        { ins: "SELL_TO_OPEN", qty: 1, sym: sym("P", 5895) },
        { ins: "BUY_TO_OPEN", qty: 1, sym: sym("P", 5900) },
        { ins: "BUY_TO_OPEN", qty: 1, sym: sym("C", 5900) },
        { ins: "SELL_TO_OPEN", qty: 1, sym: sym("C", 5905) },
      ],
      3,
    );
    const r = schwabOrderMaxRisk(o);
    if (r.kind === "known") expect(r.maxRisk).toBe(300);
  });

  it("long put condor debit maxLoss 100", () => {
    const o = limitOrder(
      [
        { ins: "BUY_TO_OPEN", qty: 1, sym: sym("P", 480) },
        { ins: "SELL_TO_OPEN", qty: 1, sym: sym("P", 485) },
        { ins: "SELL_TO_OPEN", qty: 1, sym: sym("P", 495) },
        { ins: "BUY_TO_OPEN", qty: 1, sym: sym("P", 500) },
      ],
      1,
    );
    const r = schwabOrderMaxRisk(o);
    if (r.kind === "known") expect(r.maxRisk).toBe(100);
  });

  it("50-lot long IC maxLoss 20000 and RED on 30k", () => {
    const o = limitOrder(
      [
        { ins: "BUY_TO_OPEN", qty: 50, sym: sym("P", 5900) },
        { ins: "SELL_TO_OPEN", qty: 50, sym: sym("P", 5895) },
        { ins: "SELL_TO_OPEN", qty: 50, sym: sym("C", 5950) },
        { ins: "BUY_TO_OPEN", qty: 50, sym: sym("C", 5955) },
      ],
      4,
    );
    const r = schwabOrderMaxRisk(o);
    if (r.kind === "known") expect(r.maxRisk).toBe(20_000);
    const gate = evaluateServerPlaceOrderGate({ order: o, accountEquity: 30_000 });
    expect(gate.checks.find((c) => c.id === "size")?.level).toBe("RED");
  });
});

describe("unbounded loss finite profit", () => {
  it("long call + 2 short calls credit 1: maxProfit 600, BE 511", () => {
    const e = analyzeExpirationPayoff({
      legs: [
        { strike: 500, optionType: "CALL", instruction: "BUY_TO_OPEN", quantity: 1 },
        { strike: 505, optionType: "CALL", instruction: "SELL_TO_OPEN", quantity: 2 },
      ],
      netPerShare: 1,
      spreadUnits: 1,
      isCredit: true,
      isOption: true,
    });
    expect(e.maxLoss).toBeNull();
    expect(e.maxProfit).toBe(600);
    expect(e.breakevens.some((b) => Math.abs(b - 511) < 0.02)).toBe(true);
  });

  it("short strangle credit: maxProfit 500, BE 495 and 605", () => {
    const e = analyzeExpirationPayoff({
      legs: [
        { strike: 5900, optionType: "PUT", instruction: "SELL_TO_OPEN", quantity: 1 },
        { strike: 6000, optionType: "CALL", instruction: "SELL_TO_OPEN", quantity: 1 },
      ],
      netPerShare: 5,
      spreadUnits: 1,
      isCredit: true,
      isOption: true,
    });
    expect(e.maxLoss).toBeNull();
    expect(e.maxProfit).toBe(500);
    expect(e.breakevens.some((b) => Math.abs(b - 5895) < 0.02)).toBe(true);
    expect(e.breakevens.some((b) => Math.abs(b - 6005) < 0.02)).toBe(true);
  });

  it("put BWB credit BE 489", () => {
    const e = analyzeExpirationPayoff({
      legs: [
        { strike: 485, optionType: "PUT", instruction: "BUY_TO_OPEN", quantity: 1 },
        { strike: 495, optionType: "PUT", instruction: "SELL_TO_OPEN", quantity: 2 },
        { strike: 500, optionType: "PUT", instruction: "BUY_TO_OPEN", quantity: 1 },
      ],
      netPerShare: 1,
      spreadUnits: 1,
      isCredit: true,
      isOption: true,
    });
    expect(e.maxLoss).toBe(400);
    expect(e.breakevens.some((b) => Math.abs(b - 489) < 0.02)).toBe(true);
  });
});