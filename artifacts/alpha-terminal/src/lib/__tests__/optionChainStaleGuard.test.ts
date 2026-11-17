import { describe, expect, it } from "vitest";
import {
  normalizeOptionChainSymbol,
  optionChainMatchesActiveSymbol,
} from "../optionChainStaleGuard";

describe("option chain symbol switch guard", () => {
  it("normalizes dollar-prefixed symbols", () => {
    expect(normalizeOptionChainSymbol("$SPX")).toBe("SPX");
    expect(normalizeOptionChainSymbol(" spx ")).toBe("SPX");
  });

  it("rejects stale chain payload when active symbol changed", () => {
    expect(optionChainMatchesActiveSymbol("NVDA", "AAPL")).toBe(false);
    expect(optionChainMatchesActiveSymbol("$SPX", "SPX")).toBe(true);
    expect(optionChainMatchesActiveSymbol(undefined, "QQQ")).toBe(true);
  });
});