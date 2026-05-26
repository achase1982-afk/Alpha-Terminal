import { describe, expect, it } from "vitest";
import { applyCatalystOptionsGate } from "../applyCatalystCheapGates.js";
import type { TradeabilityCandidate } from "../../movers/tradeabilityGate.js";

const c = (symbol: string): TradeabilityCandidate => ({
  symbol,
  name: symbol,
  price: 20,
  changePct: 0,
});

describe("applyCatalystOptionsGate", () => {
  it("drops only explicit no; keeps unknown", () => {
    const survivors = [c("OKTA"), c("NOPE"), c("MAYBE")];
    const verdicts = new Map([
      ["OKTA", "yes"],
      ["NOPE", "no"],
      ["MAYBE", "unknown"],
    ] as const);
    const { tradeable, filtered, optionsStatusBySymbol } = applyCatalystOptionsGate(
      survivors,
      verdicts,
    );
    expect(tradeable.map((t) => t.symbol)).toEqual(["OKTA", "MAYBE"]);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.reason).toBe("NO_OPTIONS");
    expect(optionsStatusBySymbol.get("MAYBE")).toBe("unknown");
  });
});
