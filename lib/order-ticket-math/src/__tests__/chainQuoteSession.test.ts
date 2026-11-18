import { describe, expect, it } from "vitest";
import {
  equityOptionsGthOpenMs,
  equityOptionsSessionOpen,
  formatQuoteAsOfEt,
  isCarryoverOptionQuote,
} from "../chainQuoteSession.js";
import { quoteSideState, resolveChainQuotePresentation } from "../optionQuotes.js";

describe("chainQuoteSession", () => {
  it("treats locked bid === ask as valid", () => {
    expect(quoteSideState(0.54, 0.54)).toBe("ok");
  });

  it("shows prior-session carryover with dimmed prices", () => {
    const gth = equityOptionsGthOpenMs(Date.now());
    const priorClose = gth - 18 * 3_600_000;
    expect(isCarryoverOptionQuote(priorClose, gth + 30 * 60_000)).toBe(true);
    const view = resolveChainQuotePresentation({
      bid: 5.05,
      ask: 5.45,
      quoteTimeMs: priorClose,
      nowMs: gth + 30 * 60_000,
    });
    expect(view.displayState).toBe("prior_session");
    expect(view.showBid).toBe(5.05);
    expect(view.dimmed).toBe(true);
    expect(view.asOfLabel).toContain("as of");
  });

  it("flags locked pairs without suppressing prices", () => {
    const gth = equityOptionsGthOpenMs(Date.now());
    const prior = gth - 18 * 3_600_000;
    const view = resolveChainQuotePresentation({
      bid: 0.54,
      ask: 0.54,
      quoteTimeMs: prior,
      nowMs: gth - 30 * 60_000,
    });
    expect(view.locked).toBe(true);
    expect(view.showBid).toBe(0.54);
    expect(view.displayState).toBe("prior_session");
  });

  it("formats as-of label in Eastern time", () => {
    const ts = Date.parse("2025-11-17T21:15:00.000Z");
    const label = formatQuoteAsOfEt(ts);
    expect(label).toMatch(/as of .* 11\/17/);
  });

  it("reports options closed before 7:30 AM ET", () => {
    const gth = equityOptionsGthOpenMs(Date.now());
    expect(equityOptionsSessionOpen(gth - 60_000)).toBe(false);
    expect(equityOptionsSessionOpen(gth + 60_000)).toBe(true);
  });
});