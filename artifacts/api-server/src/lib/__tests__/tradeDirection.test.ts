import { describe, it, expect } from "vitest";
import { deriveTradeDirection } from "@workspace/strategist-card-bullets";

describe("deriveTradeDirection", () => {
  it("labels put credit spread BULLISH from strategy name", () => {
    expect(deriveTradeDirection("put_credit_spread", [])).toBe("BULLISH");
  });

  it("labels bull put spread BULLISH from vertical put strikes", () => {
    expect(
      deriveTradeDirection("vertical", [
        { type: "put", action: "sell", strike: 95 },
        { type: "put", action: "buy", strike: 90 },
      ]),
    ).toBe("BULLISH");
  });

  it("does not label put credit spread BEARISH from long put leg alone", () => {
    expect(
      deriveTradeDirection("put_spread", [
        { type: "put", action: "sell", strike: 95 },
        { type: "put", action: "buy", strike: 90 },
      ]),
    ).toBe("BULLISH");
  });

  it("uses debate verdict only when structure is neutral", () => {
    expect(
      deriveTradeDirection("iron_condor", [], "BULLISH"),
    ).toBe("NEUTRAL");
    expect(
      deriveTradeDirection("custom_structure", [], "BEARISH"),
    ).toBe("BEARISH");
  });
});
