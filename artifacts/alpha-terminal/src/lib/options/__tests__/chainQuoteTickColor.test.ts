import { describe, expect, it } from "vitest";
import { chainLivePriceColor } from "../chainQuoteTickColor";
import { DOWN, UP } from "@/components/options/optionsTheme";

describe("chainLivePriceColor", () => {
  it("uses side colors when live and flashes on tick direction", () => {
    expect(chainLivePriceColor("bid", null, false)).toBe(DOWN);
    expect(chainLivePriceColor("ask", null, false)).toBe(UP);
    expect(chainLivePriceColor("bid", "up", false)).toBe(UP);
    expect(chainLivePriceColor("ask", "down", false)).toBe(DOWN);
  });

  it("falls back to gray when dimmed", () => {
    expect(chainLivePriceColor("ask", null, true)).toMatch(/^#/);
  });
});