import { describe, expect, it } from "vitest";
import { atLadderLegKey, quoteSideFromTap } from "../atLadderLegKeys";

describe("atLadderLegKeys", () => {
  it("maps buy/sell tap to ask/bid", () => {
    expect(quoteSideFromTap("BUY")).toBe("ask");
    expect(quoteSideFromTap("SELL")).toBe("bid");
  });

  it("builds stable leg keys", () => {
    const k = atLadderLegKey(
      { expiration: "2026-11-18", strike: 182.5 } as never,
      "CALL",
    );
    expect(k).toBe("2026-11-18|182.5|CALL");
  });
});