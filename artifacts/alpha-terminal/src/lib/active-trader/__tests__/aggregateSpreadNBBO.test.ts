import { describe, expect, it } from "vitest";
import { aggregateSpreadNBBO, verticalStrikes } from "../aggregateSpreadNBBO";

describe("aggregateSpreadNBBO", () => {
  it("computes call debit vertical NBBO from leg quotes", () => {
    const n = aggregateSpreadNBBO({ bid: 3.5, ask: 3.65 }, { bid: 2.2, ask: 2.35 });
    expect(n.bid).toBeCloseTo(3.5 - 2.35, 6);
    expect(n.ask).toBeCloseTo(3.65 - 2.2, 6);
  });

  it("swaps when natural sell exceeds natural buy", () => {
    const n = aggregateSpreadNBBO({ bid: 1.0, ask: 1.05 }, { bid: 0.9, ask: 2.0 });
    expect(n.bid).not.toBeNull();
    expect(n.ask).not.toBeNull();
    if (n.bid != null && n.ask != null) {
      expect(n.bid).toBeLessThanOrEqual(n.ask);
    }
  });

  it("returns null sides when quotes missing", () => {
    const n = aggregateSpreadNBBO({ bid: null, ask: 3 }, { bid: 1, ask: null });
    expect(n.bid).toBeNull();
    expect(n.ask).toBe(2);
  });
});

describe("verticalStrikes", () => {
  it("offsets call wing upward", () => {
    expect(verticalStrikes(7545, 5, "CALL")).toEqual({ near: 7545, far: 7550 });
  });
  it("offsets put wing downward", () => {
    expect(verticalStrikes(7545, 5, "PUT")).toEqual({ near: 7545, far: 7540 });
  });
});