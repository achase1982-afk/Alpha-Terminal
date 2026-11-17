import { describe, expect, it } from "vitest";
import { evaluateServerPlaceOrderGate } from "../serverPlaceOrderGate.js";
import { schwabOrderMaxRisk } from "../schwabOrderRisk.js";
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

function netDebitOrder(legs: Array<{ ins: string; qty: number; sym: string }>, price: number) {
  return {
    orderType: "NET_DEBIT",
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
    expect(r.kind === "known" ? r.maxRisk : 0).toBe(400);
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
    expect(r.kind).toBe("known");
    expect(r.kind === "known" ? r.maxRisk : 0).toBe(100);
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
    expect(r.kind).toBe("known");
    expect(r.kind === "known" ? r.maxRisk : 0).toBe(200);
  });

  it("reverse IC debit at 4.00 maxLoss 400", () => {
    const o = limitOrder(
      [
        { ins: "BUY_TO_OPEN", qty: 1, sym: sym("P", 5900) },
        { ins: "SELL_TO_OPEN", qty: 1, sym: sym("P", 5895) },
        { ins: "BUY_TO_OPEN", qty: 1, sym: sym("C", 5950) },
        { ins: "SELL_TO_OPEN", qty: 1, sym: sym("C", 5955) },
      ],
      4,
    );
    const r = schwabOrderMaxRisk(o);
    expect(r.kind).toBe("known");
    expect(r.kind === "known" ? r.maxRisk : 0).toBe(400);
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
    expect(r.kind).toBe("known");
    expect(r.kind === "known" ? r.maxRisk : 0).toBe(300);
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
    expect(r.kind).toBe("known");
    expect(r.kind === "known" ? r.maxRisk : 0).toBe(100);
  });

  it("50-lot reverse IC maxLoss 20000 and RED on 30k", () => {
    const o = limitOrder(
      [
        { ins: "BUY_TO_OPEN", qty: 50, sym: sym("P", 5900) },
        { ins: "SELL_TO_OPEN", qty: 50, sym: sym("P", 5895) },
        { ins: "BUY_TO_OPEN", qty: 50, sym: sym("C", 5950) },
        { ins: "SELL_TO_OPEN", qty: 50, sym: sym("C", 5955) },
      ],
      4,
    );
    const r = schwabOrderMaxRisk(o);
    expect(r.kind).toBe("known");
    expect(r.kind === "known" ? r.maxRisk : 0).toBe(20_000);
    const gate = evaluateServerPlaceOrderGate({ order: o, accountEquity: 30_000 });
    expect(gate.checks.find((c) => c.id === "size")?.level).toBe("RED");
  });
});

describe("no debit premium cap understates", () => {
  it("short IC as NET_DEBIT 0.50 maxLoss 550 not 50", () => {
    const o = netDebitOrder(
      [
        { ins: "BUY_TO_OPEN", qty: 1, sym: sym("P", 5890) },
        { ins: "SELL_TO_OPEN", qty: 1, sym: sym("P", 5895) },
        { ins: "SELL_TO_OPEN", qty: 1, sym: sym("C", 5950) },
        { ins: "BUY_TO_OPEN", qty: 1, sym: sym("C", 5955) },
      ],
      0.5,
    );
    const r = schwabOrderMaxRisk(o);
    expect(r.kind).toBe("known");
    expect(r.kind === "known" ? r.maxRisk : 0).toBe(550);
  });

  it("call condor +1/-2/-1/+2 at 1.00 debit maxLoss 1100", () => {
    const o = limitOrder(
      [
        { ins: "BUY_TO_OPEN", qty: 1, sym: sym("C", 5900) },
        { ins: "SELL_TO_OPEN", qty: 2, sym: sym("C", 5905) },
        { ins: "SELL_TO_OPEN", qty: 1, sym: sym("C", 5910) },
        { ins: "BUY_TO_OPEN", qty: 2, sym: sym("C", 5915) },
      ],
      1,
    );
    const r = schwabOrderMaxRisk(o);
    expect(r.kind).toBe("known");
    expect(r.kind === "known" ? r.maxRisk : 0).toBe(1100);
  });

  it("put condor +1/-2/+2/-1 at 1.00 debit maxLoss 600", () => {
    const o = limitOrder(
      [
        { ins: "BUY_TO_OPEN", qty: 1, sym: sym("P", 5900) },
        { ins: "SELL_TO_OPEN", qty: 2, sym: sym("P", 5905) },
        { ins: "BUY_TO_OPEN", qty: 2, sym: sym("P", 5910) },
        { ins: "SELL_TO_OPEN", qty: 1, sym: sym("P", 5915) },
      ],
      1,
    );
    const r = schwabOrderMaxRisk(o);
    expect(r.kind).toBe("known");
    expect(r.kind === "known" ? r.maxRisk : 0).toBe(600);
  });

  it("mixed bear put debit plus bear call credit LIMIT 1.00 maxLoss 600", () => {
    const o = limitOrder(
      [
        { ins: "BUY_TO_OPEN", qty: 1, sym: sym("P", 5900) },
        { ins: "SELL_TO_OPEN", qty: 1, sym: sym("P", 5895) },
        { ins: "SELL_TO_OPEN", qty: 1, sym: sym("C", 5950) },
        { ins: "BUY_TO_OPEN", qty: 1, sym: sym("C", 5955) },
      ],
      1,
    );
    const r = schwabOrderMaxRisk(o);
    expect(r.kind).toBe("known");
    expect(r.kind === "known" ? r.maxRisk : 0).toBe(600);
  });

  it("mixed legs BUY P5900/SELL P5895/BUY C5955/SELL C5950 at 4.00 maxLoss 900", () => {
    const o = limitOrder(
      [
        { ins: "BUY_TO_OPEN", qty: 1, sym: sym("P", 5900) },
        { ins: "SELL_TO_OPEN", qty: 1, sym: sym("P", 5895) },
        { ins: "BUY_TO_OPEN", qty: 1, sym: sym("C", 5955) },
        { ins: "SELL_TO_OPEN", qty: 1, sym: sym("C", 5950) },
      ],
      4,
    );
    const r = schwabOrderMaxRisk(o);
    expect(r.kind).toBe("known");
    expect(r.kind === "known" ? r.maxRisk : 0).toBe(900);
  });

  it("50-lot mixed debit wings maxLoss 45000", () => {
    const o = limitOrder(
      [
        { ins: "BUY_TO_OPEN", qty: 50, sym: sym("P", 5900) },
        { ins: "SELL_TO_OPEN", qty: 50, sym: sym("P", 5895) },
        { ins: "BUY_TO_OPEN", qty: 50, sym: sym("C", 5955) },
        { ins: "SELL_TO_OPEN", qty: 50, sym: sym("C", 5950) },
      ],
      4,
    );
    const r = schwabOrderMaxRisk(o);
    expect(r.kind).toBe("known");
    expect(r.kind === "known" ? r.maxRisk : 0).toBe(45_000);
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
