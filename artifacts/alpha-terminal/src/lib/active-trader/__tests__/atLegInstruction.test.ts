import { describe, expect, it } from "vitest";
import { quoteSideFromTap } from "@/lib/active-trader/atLadderLegKeys";

describe("at leg quote side", () => {
  it("maps SELL tap to bid leg and BUY tap to ask leg", () => {
    expect(quoteSideFromTap("SELL")).toBe("bid");
    expect(quoteSideFromTap("BUY")).toBe("ask");
  });

  it("derives instruction from leg side", () => {
    const instr = (side: "bid" | "ask") => (side === "bid" ? "SELL_TO_OPEN" : "BUY_TO_OPEN");
    expect(instr(quoteSideFromTap("SELL"))).toBe("SELL_TO_OPEN");
    expect(instr(quoteSideFromTap("BUY"))).toBe("BUY_TO_OPEN");
  });
});