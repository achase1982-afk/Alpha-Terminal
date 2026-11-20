import { describe, expect, it } from "vitest";
import { chainLivePriceColor } from "../chainQuoteTickColor";
import { DOWN, UP } from "@/components/options/optionsTheme";
import { CHAIN_LADDER_CELL_COLOR } from "@/lib/options/strikeColumnChrome";

describe("chainLivePriceColor", () => {
  it("stays off-white until a websocket tick, then follows that move", () => {
    expect(chainLivePriceColor("bid", null, false)).toBe(CHAIN_LADDER_CELL_COLOR);
    expect(chainLivePriceColor("ask", null, false)).toBe(CHAIN_LADDER_CELL_COLOR);
    expect(chainLivePriceColor("bid", "up", false)).toBe(UP);
    expect(chainLivePriceColor("ask", "up", false)).toBe(UP);
    expect(chainLivePriceColor("bid", "down", false)).toBe(DOWN);
    expect(chainLivePriceColor("ask", "down", false)).toBe(DOWN);
  });

  it("keeps a dead quote off-white even if a tick arrow is still set", () => {
    expect(chainLivePriceColor("bid", "up", true)).toBe(CHAIN_LADDER_CELL_COLOR);
    expect(chainLivePriceColor("ask", "down", true)).toBe(CHAIN_LADDER_CELL_COLOR);
  });
});
