import { describe, expect, it } from "vitest";
import { classifySession, normalizeQuote } from "../quote-normalizer.js";

/** Friday 2026-05-22 17:00 ET — after-hours per classifySession. */
const AFTER_HOURS_ET = new Date("2026-05-22T21:00:00.000Z");

describe("normalizeQuote", () => {
  it("acceptance: after-hours QBTS-style move decomposes correctly", () => {
    expect(classifySession(AFTER_HOURS_ET)).toBe("after-hours");

    const n = normalizeQuote(
      {
        symbol: "QBTS",
        priorClose: 38.19,
        todayRegularClose: 41.3,
        lastPrice: 45.6,
        lastTradeTime: "2026-05-22T21:00:00.000Z",
      },
      AFTER_HOURS_ET,
    );

    expect(n.totalChange).toBe(7.41);
    expect(n.totalChangePct).toBe(19.4);
    expect(n.regularChange).toBe(3.11);
    expect(n.regularChangePct).toBe(8.14);
    expect(n.extendedChange).toBe(4.3);
    expect(n.extendedChangePct).toBe(10.41);
    expect(n.summary).toBe(
      "After-hours $45.60, +$7.41 (+19.40%) vs prior close $38.19. Regular session closed $41.30 (+$3.11, +8.14%); extended leg +$4.30 (+10.41%) on top.",
    );
  });
});
