import { describe, expect, it } from "vitest";
import { schwabOrderMaxRisk } from "../schwabOrderRisk.js";

const sym = (cp: "C" | "P", strike: number) =>
  `SPXW  261118${cp}${String(Math.round(strike * 1000)).padStart(8, "0")}`;

describe("butterfly and iron fly LIMIT risk", () => {
  it("long call butterfly debit 1.50 per spread is $150 max loss", () => {
    const risk = schwabOrderMaxRisk({
      orderType: "LIMIT",
      price: 1.5,
      orderLegCollection: [
        { instruction: "BUY_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: sym("C", 5895) } },
        { instruction: "SELL_TO_OPEN", quantity: 2, instrument: { assetType: "OPTION", symbol: sym("C", 5900) } },
        { instruction: "BUY_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: sym("C", 5905) } },
      ],
    });
    expect(risk.kind).toBe("known");
    if (risk.kind === "known") expect(risk.maxRisk).toBe(150);
  });

  it("short call butterfly credit 1.00 on 5-wide wing is $400 max loss", () => {
    const risk = schwabOrderMaxRisk({
      orderType: "LIMIT",
      price: 1,
      orderLegCollection: [
        { instruction: "SELL_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: sym("C", 5895) } },
        { instruction: "BUY_TO_OPEN", quantity: 2, instrument: { assetType: "OPTION", symbol: sym("C", 5900) } },
        { instruction: "SELL_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: sym("C", 5905) } },
      ],
    });
    expect(risk.kind).toBe("known");
    if (risk.kind === "known") expect(risk.maxRisk).toBe(400);
  });

  it("iron fly credit 3.00 with 5-wide wings is $200 max loss", () => {
    const risk = schwabOrderMaxRisk({
      orderType: "LIMIT",
      price: 3,
      orderLegCollection: [
        { instruction: "BUY_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: sym("P", 5895) } },
        { instruction: "SELL_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: sym("P", 5900) } },
        { instruction: "SELL_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: sym("C", 5900) } },
        { instruction: "BUY_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: sym("C", 5905) } },
      ],
    });
    expect(risk.kind).toBe("known");
    if (risk.kind === "known") expect(risk.maxRisk).toBe(200);
  });

  it("call broken-wing butterfly debit 1.00 loses up to $600", () => {
    const risk = schwabOrderMaxRisk({
      orderType: "LIMIT",
      price: 1,
      orderLegCollection: [
        { instruction: "BUY_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: sym("C", 500) } },
        { instruction: "SELL_TO_OPEN", quantity: 2, instrument: { assetType: "OPTION", symbol: sym("C", 505) } },
        { instruction: "BUY_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: sym("C", 515) } },
      ],
    });
    expect(risk.kind).toBe("known");
    if (risk.kind === "known") expect(risk.maxRisk).toBe(600);
  });

  it("put broken-wing butterfly credit 1.00 loses up to $400", () => {
    const risk = schwabOrderMaxRisk({
      orderType: "LIMIT",
      price: 1,
      orderLegCollection: [
        { instruction: "SELL_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: sym("P", 485) } },
        { instruction: "BUY_TO_OPEN", quantity: 2, instrument: { assetType: "OPTION", symbol: sym("P", 495) } },
        { instruction: "SELL_TO_OPEN", quantity: 1, instrument: { assetType: "OPTION", symbol: sym("P", 500) } },
      ],
    });
    expect(risk.kind).toBe("known");
    if (risk.kind === "known") expect(risk.maxRisk).toBe(400);
  });

  it("10-lot long call butterfly debit scales to $1,500", () => {
    const risk = schwabOrderMaxRisk({
      orderType: "LIMIT",
      price: 1.5,
      orderLegCollection: [
        { instruction: "BUY_TO_OPEN", quantity: 10, instrument: { assetType: "OPTION", symbol: sym("C", 5895) } },
        { instruction: "SELL_TO_OPEN", quantity: 20, instrument: { assetType: "OPTION", symbol: sym("C", 5900) } },
        { instruction: "BUY_TO_OPEN", quantity: 10, instrument: { assetType: "OPTION", symbol: sym("C", 5905) } },
      ],
    });
    expect(risk.kind).toBe("known");
    if (risk.kind === "known") expect(risk.maxRisk).toBe(1500);
  });
});
