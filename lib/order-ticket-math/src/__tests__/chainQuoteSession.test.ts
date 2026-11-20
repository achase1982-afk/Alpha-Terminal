import { describe, expect, it } from "vitest";
import {
  equityOptionsGthOpenMs,
  equityOptionsClosedPill,
  equityOptionsSessionOpen,
  formatQuoteAsOfEt,
  isCarryoverOptionQuote,
} from "../chainQuoteSession.js";
import { quoteSideState, resolveChainQuotePresentation } from "../optionQuotes.js";

describe("chainQuoteSession", () => {
  it("treats locked bid === ask as valid", () => {
    expect(quoteSideState(0.54, 0.54)).toBe("ok");
  });

  it("shows ok for two-sided books without a session calendar gate", () => {
    const gth = equityOptionsGthOpenMs(Date.now());
    const priorClose = gth - 18 * 3_600_000;
    expect(isCarryoverOptionQuote(priorClose, gth + 30 * 60_000)).toBe(false);
    const view = resolveChainQuotePresentation({
      bid: 5.05,
      ask: 5.45,
      quoteTimeMs: priorClose,
      nowMs: gth + 30 * 60_000,
    });
    expect(view.displayState).toBe("ok");
    expect(view.showBid).toBe(5.05);
    expect(view.dimmed).toBe(false);
    expect(view.tapable).toBe(true);
    expect(view.asOfLabel).toBeNull();
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
    expect(view.displayState).toBe("ok");
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
    expect(equityOptionsClosedPill(gth - 60_000)).toBe("Options closed · GTH opens 7:30 AM ET");
  });

  it("keeps the options gate shut on weekends, holidays, and after an early close", () => {
    const saturdayMorning = Date.parse("2026-11-21T15:00:00.000Z");
    expect(equityOptionsSessionOpen(saturdayMorning)).toBe(false);
    expect(equityOptionsClosedPill(saturdayMorning)).toBe("Options closed · next GTH 7:30 AM ET");

    const thanksgiving = Date.parse("2026-11-26T15:00:00.000Z");
    expect(equityOptionsSessionOpen(thanksgiving)).toBe(false);
    expect(equityOptionsClosedPill(thanksgiving)).toContain("next GTH");

    const earlyStillOpen = Date.parse("2026-11-27T17:30:00.000Z");
    const earlyClosed = Date.parse("2026-11-27T18:00:00.000Z");
    expect(equityOptionsSessionOpen(earlyStillOpen)).toBe(true);
    expect(equityOptionsSessionOpen(earlyClosed)).toBe(false);
    expect(equityOptionsClosedPill(earlyClosed)).toContain("next GTH");
  });

  it("returns 7:30:00 AM Eastern for any instant of that Eastern day", () => {
    const winterOpen = Date.parse("2026-11-18T12:30:00.000Z");
    for (const iso of [
      "2026-11-18T05:00:00.000Z",
      "2026-11-18T12:29:59.999Z",
      "2026-11-18T12:30:00.000Z",
      "2026-11-18T19:30:41.250Z",
      "2026-11-19T04:59:59.000Z",
    ]) {
      expect(equityOptionsGthOpenMs(Date.parse(iso))).toBe(winterOpen);
    }
    expect(equityOptionsGthOpenMs(Date.parse("2026-11-19T05:00:00.000Z"))).toBe(
      Date.parse("2026-11-19T12:30:00.000Z"),
    );
    expect(equityOptionsGthOpenMs(Date.parse("2026-07-15T18:00:00.000Z"))).toBe(
      Date.parse("2026-07-15T11:30:00.000Z"),
    );
  });

  it("stays on 7:30 AM Eastern across daylight-saving switches", () => {
    const springOpen = Date.parse("2026-03-08T11:30:00.000Z");
    expect(equityOptionsGthOpenMs(Date.parse("2026-03-08T05:30:00.000Z"))).toBe(springOpen);
    expect(equityOptionsGthOpenMs(Date.parse("2026-03-08T16:00:00.000Z"))).toBe(springOpen);
    const fallOpen = Date.parse("2026-11-01T12:30:00.000Z");
    expect(equityOptionsGthOpenMs(Date.parse("2026-11-01T04:30:00.000Z"))).toBe(fallOpen);
    expect(equityOptionsGthOpenMs(Date.parse("2026-11-01T20:00:00.000Z"))).toBe(fallOpen);
  });

  it("keeps the session window at 7:30 AM to 4:15 PM Eastern", () => {
    expect(equityOptionsSessionOpen(Date.parse("2026-11-18T12:29:59.000Z"))).toBe(false);
    expect(equityOptionsSessionOpen(Date.parse("2026-11-18T12:30:00.000Z"))).toBe(true);
    expect(equityOptionsSessionOpen(Date.parse("2026-11-18T21:14:59.000Z"))).toBe(true);
    expect(equityOptionsSessionOpen(Date.parse("2026-11-18T21:15:00.000Z"))).toBe(false);
  });

  it("is cheap enough to call once per quote cell", () => {
    const base = Date.parse("2026-11-18T19:30:00.000Z");
    const startedAt = performance.now();
    let live = 0;
    for (let i = 0; i < 20_000; i++) {
      const now = base + i * 37;
      const view = resolveChainQuotePresentation({ bid: 1.2, ask: 1.25, quoteTimeMs: now - 500, nowMs: now });
      if (view.tapable) live += 1;
    }
    const elapsedMs = performance.now() - startedAt;
    expect(live).toBe(20_000);
    // One Intl.DateTimeFormat costs tens of microseconds to build; 20,000 cells must not pay that each.
    expect(elapsedMs).toBeLessThan(1_000);
  });
});