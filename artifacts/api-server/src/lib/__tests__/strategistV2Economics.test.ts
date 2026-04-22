import { describe, it, expect } from "vitest";
import { partitionIntoTwoVerticals, type CandidateLeg } from "../strategistV2.js";

function leg(
  side: "buy" | "sell",
  type: "call" | "put",
  strike: number,
  exp = "2026-05-01",
): CandidateLeg {
  return {
    type,
    side,
    strike,
    expiration: exp,
    bid: 1,
    ask: 1.1,
    mid: 1.05,
    delta: type === "call" ? 0.3 : -0.3,
    openInterest: 500,
  };
}

describe("partitionIntoTwoVerticals", () => {
  it("symmetric iron condor (INTC repro): 10-wide both sides", () => {
    const legs = [
      leg("buy", "put", 50),
      leg("sell", "put", 60),
      leg("sell", "call", 70),
      leg("buy", "call", 80),
    ];
    const p = partitionIntoTwoVerticals(legs);
    expect(p).not.toBeNull();
    expect(p!.kind).toBe("iron_condor_or_butterfly");
    expect(p!.wing1Width).toBe(10);
    expect(p!.wing2Width).toBe(10);
    expect(p!.maxWingWidth).toBe(10);
    // INTC bug: validator was returning $2680 for $3.12 credit;
    // correct max risk = max_wing*100 - credit = 1000 - 312 = $688
    const credit = 3.12;
    const maxRisk = p!.maxWingWidth * 100 - credit * 100;
    expect(maxRisk).toBe(688);
  });

  it("asymmetric iron condor: 10-wide puts, 5-wide calls — picks the larger wing", () => {
    const legs = [
      leg("buy", "put", 90),
      leg("sell", "put", 100),
      leg("sell", "call", 110),
      leg("buy", "call", 115),
    ];
    const p = partitionIntoTwoVerticals(legs);
    expect(p).not.toBeNull();
    expect(p!.wing1Width).toBe(10);
    expect(p!.wing2Width).toBe(5);
    expect(p!.maxWingWidth).toBe(10);
    // Critical regression guard: the buggy formula would have used (115-90)=25.
    expect(p!.maxWingWidth).not.toBe(25);
    expect(p!.maxWingWidth).not.toBe(15);
  });

  it("iron butterfly: shared short strike", () => {
    const legs = [
      leg("buy", "put", 95),
      leg("sell", "put", 100),
      leg("sell", "call", 100),
      leg("buy", "call", 105),
    ];
    const p = partitionIntoTwoVerticals(legs);
    expect(p).not.toBeNull();
    expect(p!.kind).toBe("iron_condor_or_butterfly");
    expect(p!.maxWingWidth).toBe(5);
  });

  it("long call condor: all four legs calls, buy/sell/sell/buy by strike", () => {
    const legs = [
      leg("buy", "call", 100),
      leg("sell", "call", 105),
      leg("sell", "call", 115),
      leg("buy", "call", 120),
    ];
    const p = partitionIntoTwoVerticals(legs);
    expect(p).not.toBeNull();
    expect(p!.kind).toBe("same_side_condor_or_butterfly");
    expect(p!.wing1Width).toBe(5);
    expect(p!.wing2Width).toBe(5);
    expect(p!.maxWingWidth).toBe(5);
  });

  it("short put condor: all four legs puts, sell/buy/buy/sell by strike", () => {
    const legs = [
      leg("sell", "put", 80),
      leg("buy", "put", 85),
      leg("buy", "put", 95),
      leg("sell", "put", 100),
    ];
    const p = partitionIntoTwoVerticals(legs);
    expect(p).not.toBeNull();
    expect(p!.kind).toBe("same_side_condor_or_butterfly");
    expect(p!.maxWingWidth).toBe(5);
  });

  it("short vertical (2 legs): falls through, partition returns null", () => {
    const legs = [
      leg("sell", "call", 100),
      leg("buy", "call", 105),
    ];
    expect(partitionIntoTwoVerticals(legs)).toBeNull();
  });

  it("2:1 call ratio (3 legs, unequal): falls through, no crash", () => {
    const legs = [
      leg("buy", "call", 100),
      leg("sell", "call", 110),
      leg("sell", "call", 110),
    ];
    expect(partitionIntoTwoVerticals(legs)).toBeNull();
  });

  it("4-leg ratio (3 sells + 1 buy of same type): falls through", () => {
    const legs = [
      leg("buy", "call", 100),
      leg("sell", "call", 110),
      leg("sell", "call", 110),
      leg("sell", "call", 115),
    ];
    expect(partitionIntoTwoVerticals(legs)).toBeNull();
  });

  it("multi-expiration 4-leg structure (diagonal-ish): falls through", () => {
    const legs = [
      leg("buy", "put", 50, "2026-05-01"),
      leg("sell", "put", 60, "2026-05-01"),
      leg("sell", "call", 70, "2026-06-19"),
      leg("buy", "call", 80, "2026-06-19"),
    ];
    expect(partitionIntoTwoVerticals(legs)).toBeNull();
  });

  it("2 calls + 2 puts where call side is not a vertical (same side both buy): falls through", () => {
    const legs = [
      leg("buy", "put", 50),
      leg("sell", "put", 60),
      leg("buy", "call", 70),
      leg("buy", "call", 80),
    ];
    expect(partitionIntoTwoVerticals(legs)).toBeNull();
  });
});
