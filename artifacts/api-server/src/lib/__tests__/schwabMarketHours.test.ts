import { describe, it, expect } from "vitest";
import { __classifyEquitySessionForTests, __extractEquityDayForTests } from "../schwabMarketHours.js";

describe("extractEquityDay (Schwab markets shape)", () => {
  it("parses sessionHours when periods are array-wrapped (Schwab/TD style)", () => {
    const json = {
      equity: {
        EQ: {
          sessionHours: {
            preMarket: [{ start: "2026-01-02T08:00:00-05:00", end: "2026-01-02T09:30:00-05:00" }],
            regularMarket: [{ start: "2026-01-02T09:30:00-05:00", end: "2026-01-02T16:00:00-05:00" }],
            postMarket: [{ start: "2026-01-02T16:00:00-05:00", end: "2026-01-02T20:00:00-05:00" }],
          },
        },
      },
    };
    const { pre, reg, post } = __extractEquityDayForTests(json);
    expect(pre?.start).toBe(Date.parse("2026-01-02T08:00:00-05:00"));
    expect(reg?.start).toBe(Date.parse("2026-01-02T09:30:00-05:00"));
    expect(post?.end).toBe(Date.parse("2026-01-02T20:00:00-05:00"));
  });

  it("still parses plain { start, end } objects", () => {
    const json = {
      equity: {
        EQ: {
          sessionHours: {
            regularMarket: { start: "2026-01-02T09:30:00-05:00", end: "2026-01-02T16:00:00-05:00" },
          },
        },
      },
    };
    const { reg } = __extractEquityDayForTests(json);
    expect(reg?.start).toBe(Date.parse("2026-01-02T09:30:00-05:00"));
    expect(reg?.end).toBe(Date.parse("2026-01-02T16:00:00-05:00"));
  });
});

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
