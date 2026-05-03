import { describe, it, expect } from "vitest";
import { __classifyEquitySessionForTests } from "../schwabMarketHours.js";

describe("__classifyEquitySessionForTests", () => {
  it("returns open inside regular window", () => {
    const reg = { start: 1_000, end: 2_000 };
    expect(__classifyEquitySessionForTests(1_500, null, reg, null)).toBe("open");
  });

  it("returns premarket inside pre window when regular is later", () => {
    const pre = { start: 500, end: 1_000 };
    const reg = { start: 1_000, end: 2_000 };
    expect(__classifyEquitySessionForTests(750, pre, reg, null)).toBe("premarket");
  });

  it("returns afterhours inside post window", () => {
    const post = { start: 2_000, end: 3_000 };
    expect(__classifyEquitySessionForTests(2_500, null, null, post)).toBe("afterhours");
  });

  it("returns closed outside all windows", () => {
    const reg = { start: 1_000, end: 2_000 };
    expect(__classifyEquitySessionForTests(100, null, reg, null)).toBe("closed");
    expect(__classifyEquitySessionForTests(5_000, null, reg, null)).toBe("closed");
  });

  it("prefers regular over overlapping pre (regular checked first)", () => {
    const pre = { start: 500, end: 1_500 };
    const reg = { start: 1_000, end: 2_000 };
    expect(__classifyEquitySessionForTests(1_200, pre, reg, null)).toBe("open");
  });
});
