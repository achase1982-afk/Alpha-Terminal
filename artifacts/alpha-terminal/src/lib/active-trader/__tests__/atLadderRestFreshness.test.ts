import { afterEach, describe, expect, it } from "vitest";
import { resolveChainQuotePresentation } from "@workspace/order-ticket-math";
import { AtLadderVolumeHeatEngine } from "../atLadderVolumeHeatEngine";
import {
  reduceRestBadge,
  restBadgeFresh,
  restQuoteEligible,
  upstreamQuoteTimeMs,
  wsSampleFresh,
  type RestBadge,
} from "../atLadderRestFreshness";
import { applyRestQuotes } from "../useAtLadderVolumeHeat";
import { useOptionsStreamStore } from "@/lib/options-stream-store";

const NOW = Date.parse("2026-11-18T19:30:00.000Z");

describe("ladder REST quote freshness", () => {
  afterEach(() => {
    useOptionsStreamStore.getState().clearTicks();
  });

  it("only a fresh matching sample restores the badge and quote eligibility", () => {
    expect(wsSampleFresh(null, NOW)).toBe(false);

    let badge: RestBadge = { quoteTimeMs: null };
    expect(restBadgeFresh(badge, NOW)).toBe(false);

    badge = reduceRestBadge(badge, { type: "sample", quoteTimeMs: NOW - 60_000 });
    expect(restBadgeFresh(badge, NOW)).toBe(false);
    expect(
      resolveChainQuotePresentation({ bid: 1, ask: 1.1, quoteTimeMs: badge.quoteTimeMs, nowMs: NOW }).displayState,
    ).not.toBe("ok");

    badge = reduceRestBadge(badge, { type: "sample", quoteTimeMs: null });
    expect(restBadgeFresh(badge, NOW)).toBe(false);
    expect(restQuoteEligible(null, NOW)).toBe(false);

    badge = reduceRestBadge(badge, { type: "error" });
    expect(restBadgeFresh(badge, NOW)).toBe(false);

    const afterError = badge;
    badge = reduceRestBadge(badge, { type: "no-match" });
    expect(badge).toEqual(afterError);
    expect(restBadgeFresh(badge, NOW)).toBe(false);

    badge = reduceRestBadge(badge, { type: "sample", quoteTimeMs: NOW - 1_000 });
    expect(restBadgeFresh(badge, NOW)).toBe(true);
    expect(restQuoteEligible(badge.quoteTimeMs, NOW)).toBe(true);
    expect(
      resolveChainQuotePresentation({ bid: 1, ask: 1.1, quoteTimeMs: badge.quoteTimeMs, nowMs: NOW }).displayState,
    ).toBe("ok");
    expect(restBadgeFresh(badge, NOW, false)).toBe(false);
  });

  it("keeps the exchange quote time off the HTTP receipt clock", () => {
    const engine = new AtLadderVolumeHeatEngine();
    const receiptMs = NOW;
    const oldQuote = NOW - 60_000;
    const summary = applyRestQuotes(
      engine,
      [{ streamKey: "C", bid: 1.2, ask: 1.3, quoteTimeMs: oldQuote, volume: 10, volumeSampledAt: oldQuote }],
      new Set(["C"]),
      receiptMs,
    );
    expect(summary).toEqual({ matched: 1, quoteTimeMs: oldQuote });
    const tick = useOptionsStreamStore.getState().ticks.C;
    expect(tick?.quoteTime).toBe(oldQuote);
    expect(tick?.ts).toBe(receiptMs);
    expect(upstreamQuoteTimeMs(undefined)).toBeNull();

    const unknown = applyRestQuotes(
      engine,
      [{ streamKey: "U", bid: 1, ask: 1.1 }],
      new Set(["U"]),
      receiptMs,
    );
    expect(unknown).toEqual({ matched: 1, quoteTimeMs: null });
    expect(useOptionsStreamStore.getState().ticks.U).toBeUndefined();
  });
});
