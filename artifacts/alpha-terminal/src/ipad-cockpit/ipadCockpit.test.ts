import { describe, expect, it } from "vitest";
import { marketClock } from "./clock";
import {
  applyLadderTap,
  inferStrategy,
  naturalNet,
  stepLimit,
  stepQty,
  ticketEconomics,
} from "./economics";
import { formatChange, formatPremium, formatStrike, pressurePercents } from "./format";
import { fullStrikes, railVisibility, visibleStrikes } from "./ladderBook";
import { BEAR, BULL, tapePill, toWire } from "./scenarios";

describe("iPad cockpit contracts", () => {
  it("formats the bear and bull headlines from the scenario matrix", () => {
    expect(formatChange(BEAR.market.changePts, BEAR.market.changePct)).toBe("-91.32 (-1.24%)");
    expect(formatChange(BULL.market.changePts, BULL.market.changePct)).toBe("+53.72 (+0.74%)");
    expect(formatPremium(BEAR.flow.calls.bought)).toBe("$880K");
    expect(formatPremium(BEAR.flow.puts.sold)).toBe("$1.36M");
    expect(formatPremium(BEAR.flow.dayNet, true)).toBe("-$4.1M");
    expect(formatPremium(BEAR.flow.m5, true)).toBe("+$900K");
    expect(formatPremium(BULL.flow.calls.bought)).toBe("$1.92M");
    expect(formatPremium(BULL.flow.dayNet, true)).toBe("+$6.8M");
    expect(formatStrike(BEAR.levels.loZone)).toBe("7,202.5");
    expect(pressurePercents(880_000, 310_000)).toEqual({ buyPct: 74, sellPct: 26 });
    expect(pressurePercents(420_000, 1_360_000)).toEqual({ buyPct: 24, sellPct: 76 });
    expect(pressurePercents(1_920_000, 410_000)).toEqual({ buyPct: 82, sellPct: 18 });
    expect(pressurePercents(290_000, 1_540_000)).toEqual({ buyPct: 16, sellPct: 84 });
  });

  it("pins the pre-staged credit and the bracket math", () => {
    const sell = BEAR.openingLegs.find((leg) => leg.side === "SELL");
    const buy = BEAR.openingLegs.find((leg) => leg.side === "BUY");
    expect(sell).toMatchObject({ strike: 7300, right: "C", price: 7.1 });
    expect(buy).toMatchObject({ strike: 7305, right: "C", price: 5 });
    expect(BEAR.openingLimit).toBe(2.1);
    expect(BULL.openingLimit).toBe(1.9);
    expect(BULL.openingLegs.map((leg) => `${leg.side} ${leg.strike}${leg.right}`)).toEqual(["SELL 7295P", "BUY 7290P"]);

    const bear = ticketEconomics("call_credit", BEAR.openingLegs, 2.1, 1);
    expect(bear).toMatchObject({ credit: true, tp: 1.05, sl: 4.2, cash: 210, maxRisk: 290 });
    const debit = ticketEconomics("debit", [{ strike: 7270 }, { strike: 7275 }], 2.1, 1);
    expect(debit).toMatchObject({ credit: false, tp: 3.15, sl: 1.05, cash: 210, maxRisk: 210 });
    expect(stepLimit(2.1, 1)).toBe(2.15);
    expect(stepLimit(0.05, -1)).toBe(0.05);
    expect(stepQty(25, 1)).toBe(25);
    expect(stepQty(1, -1)).toBe(1);
  });

  it("keeps a 29-strike ladder and preserves walls when the step is 10", () => {
    expect(fullStrikes()).toHaveLength(29);
    expect(fullStrikes()[0]).toBe(7350);
    expect(fullStrikes().at(-1)).toBe(7210);
    const visible = visibleStrikes(10, [7350, 7325, 7210, 7270, 7300, 7305]);
    expect(visible).toContain(7325);
    expect(visible).toContain(7305);
    expect(visible).toContain(7210);
    expect(visible).not.toContain(7345);
    expect(visible.every((strike) => strike % 10 === 0 || [7325, 7305].includes(strike))).toBe(true);
  });

  it("keeps call bids decreasing and put bids increasing", () => {
    for (const scenario of [BEAR, BULL]) {
      const quotes = toWire(scenario).ladder.slice().reverse();
      for (let i = 1; i < quotes.length; i++) {
        expect(quotes[i]!.callBid).toBeLessThan(quotes[i - 1]!.callBid);
        expect(quotes[i]!.putBid).toBeGreaterThan(quotes[i - 1]!.putBid);
      }
    }
  });

  it("stages, flips, and rotates ladder taps", () => {
    const first = applyLadderTap([], { strike: 7300, right: "C", side: "SELL", price: 7.1 });
    const second = applyLadderTap(first, { strike: 7305, right: "C", side: "BUY", price: 5 });
    expect(inferStrategy(second)).toBe("call_credit");
    expect(naturalNet(second, "call_credit")).toBe(2.1);
    const removed = applyLadderTap(second, { strike: 7300, right: "C", side: "SELL", price: 7.1 });
    expect(removed).toHaveLength(1);
    const flipped = applyLadderTap(second, { strike: 7300, right: "C", side: "BUY", price: 7.4 });
    expect(flipped.find((leg) => leg.strike === 7300)?.side).toBe("BUY");
    expect(inferStrategy(flipped)).toBe("debit");
    const third = applyLadderTap(second, { strike: 7295, right: "P", side: "SELL", price: 6 });
    expect(third.map((leg) => leg.strike)).toEqual([7305, 7295]);
  });

  it("shows sticky rails from the scroll geometry in the spec", () => {
    expect(
      railVisibility({ callWallTop: 0, callWallHeight: 42, gammaTop: 800, scrollTop: 40, clientHeight: 600 }),
    ).toEqual({ top: true, bottom: true });
    expect(
      railVisibility({ callWallTop: 80, callWallHeight: 42, gammaTop: 400, scrollTop: 0, clientHeight: 700 }),
    ).toEqual({ top: false, bottom: false });
  });

  it("draws the bear divergence histogram and a live close countdown", () => {
    expect(BEAR.flowAmps).toHaveLength(24);
    expect(BEAR.flowAmps.slice(0, 21).every((amp) => amp < 0)).toBe(true);
    expect(BEAR.flowAmps.slice(21).every((amp) => amp > 0)).toBe(true);
    expect(BEAR.chart.bars).toHaveLength(24);
    expect(BEAR.prices.at(-1)).toBeCloseTo(7268.68);
    expect(Math.max(...BEAR.prices)).toBeCloseTo(7316.4);
    expect(Math.min(...BEAR.prices)).toBeCloseTo(7261.96);
    expect(Math.max(...BULL.prices)).toBeCloseTo(7326.8);
    expect(Math.min(...BULL.prices)).toBeCloseTo(7271.2);
    expect(tapePill(BEAR.verdict, false)).toBe("15m ▼ SMOOTH -20.2");
    expect(tapePill(BEAR.verdict, true)).toBe("15m ↔ CHOPPY +1.9");
    expect(tapePill(BULL.verdict, false)).toBe("15m ▲ SMOOTH +18.4");

    const clock = marketClock(new Date("2026-11-20T16:54:12.000Z"));
    expect(clock).toMatchObject({
      open: true,
      statusLabel: "MARKET OPEN",
      countdownLabel: "Closes",
      countdown: "04:05:48",
      clock: "11:54:12 ET",
    });
  });
});
