import { describe, expect, it } from "vitest";
import {
  CLASS_SHARE_SYMBOL_RE,
  classShareForVendor,
  classShareSchwabStreamKey,
  classShareToDot,
  classShareToSlash,
  isClassShareSymbol,
} from "../classShareSymbology.js";

describe("classShareSymbology", () => {
  it("matches class shares but not futures or options", () => {
    expect(CLASS_SHARE_SYMBOL_RE.test("BRK.B")).toBe(true);
    expect(CLASS_SHARE_SYMBOL_RE.test("BRK/B")).toBe(true);
    expect(CLASS_SHARE_SYMBOL_RE.test("BF.B")).toBe(true);
    expect(CLASS_SHARE_SYMBOL_RE.test("BRK.A")).toBe(true);
    expect(isClassShareSymbol("/ES")).toBe(false);
    expect(isClassShareSymbol("SPY   261117C00500000")).toBe(false);
    expect(isClassShareSymbol("SPY")).toBe(false);
  });

  it("maps dot vs slash per vendor", () => {
    expect(classShareForVendor("BRK.B", "schwab")).toBe("BRK/B");
    expect(classShareForVendor("BRK/B", "schwab2")).toBe("BRK/B");
    expect(classShareForVendor("BRK.B", "tradier")).toBe("BRK/B");
    expect(classShareForVendor("BRK/B", "alpaca")).toBe("BRK.B");
    expect(classShareForVendor("BRK.B", "alpaca_paper")).toBe("BRK.B");
  });

  it("converts between dot and slash forms", () => {
    expect(classShareToSlash("brk.b")).toBe("BRK/B");
    expect(classShareToDot("brk/b")).toBe("BRK.B");
    expect(classShareSchwabStreamKey("BRK.B")).toBe("BRK/B");
  });

  it("does not treat futures, indexes, options, or bare tickers as class shares", () => {
    for (const sym of ["./ES", "/ES", "$SPX", "SPXW", "BRK", "SPX   261117C00500000"]) {
      expect(isClassShareSymbol(sym)).toBe(false);
    }
  });
});