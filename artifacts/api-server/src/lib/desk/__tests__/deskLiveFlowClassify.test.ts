import { describe, expect, it } from "vitest";
import {
  applyL1oFlowTick,
  classifyFlowAgainstPriorQuote,
  type ContractFlowState,
} from "../deskLiveFlowClassify.js";

const KEY = "SPXW  261117C05000000";

function state(vol: number, bid = 1, ask = 2, last = 1.5): ContractFlowState {
  return { prevBid: bid, prevAsk: ask, prevVolume: vol, prevLast: last };
}

describe("deskLiveFlowClassify", () => {
  it("classifies at ask as buy and at bid as sell", () => {
    expect(classifyFlowAgainstPriorQuote(2, 1, 2)).toBe("buy");
    expect(classifyFlowAgainstPriorQuote(1, 1, 2)).toBe("sell");
    expect(classifyFlowAgainstPriorQuote(1.5, 1, 2)).toBe("mid");
  });

  it("put buy burst from volume increment", () => {
    const prev = state(100);
    const { increments } = applyL1oFlowTick(prev, {
      key: "SPXW  261117P05000000",
      optionSide: "put",
      bid: 1,
      ask: 2,
      last: 2,
      volume: 110,
      rxMs: 1_000,
    });
    expect(increments).toHaveLength(1);
    expect(increments[0]!.side).toBe("buy");
    expect(increments[0]!.dollars).toBe(10 * 2 * 100);
  });

  it("call sell when last at bid", () => {
    const { increments } = applyL1oFlowTick(state(50), {
      key: KEY,
      optionSide: "call",
      bid: 1,
      ask: 2,
      last: 1,
      volume: 55,
      rxMs: 2_000,
    });
    expect(increments[0]!.side).toBe("sell");
  });

  it("mid trade between bid and ask", () => {
    const { increments } = applyL1oFlowTick(state(10), {
      key: KEY,
      optionSide: "call",
      bid: 1,
      ask: 3,
      last: 1.5,
      volume: 12,
      rxMs: 3_000,
    });
    expect(increments[0]!.side).toBe("mid");
  });

  it("uses quote after classification (quote changes between ticks)", () => {
    const first = applyL1oFlowTick(undefined, {
      key: KEY,
      optionSide: "call",
      bid: 1,
      ask: 2,
      last: 1.5,
      volume: 0,
      rxMs: 0,
    });
    const second = applyL1oFlowTick(first.next, {
      key: KEY,
      optionSide: "call",
      bid: 5,
      ask: 6,
      last: 6,
      volume: 5,
      rxMs: 1_000,
    });
    expect(second.increments[0]!.side).toBe("buy");
  });

  it("resets on negative volume (volume reset)", () => {
    const { next, increments } = applyL1oFlowTick(state(100), {
      key: KEY,
      optionSide: "call",
      bid: 1,
      ask: 2,
      last: 2,
      volume: 50,
      rxMs: 4_000,
    });
    expect(increments).toHaveLength(0);
    expect(next.prevVolume).toBe(50);
  });

  it("skips zero dVol", () => {
    const { increments } = applyL1oFlowTick(state(20), {
      key: KEY,
      optionSide: "call",
      bid: 1,
      ask: 2,
      last: 2,
      volume: 20,
      rxMs: 5_000,
    });
    expect(increments).toHaveLength(0);
  });

  it("out-of-order tick still classifies with prior state", () => {
    const prev = state(30, 1, 2, 1.5);
    const late = applyL1oFlowTick(prev, {
      key: KEY,
      optionSide: "call",
      bid: 1,
      ask: 2,
      last: 2,
      volume: 35,
      rxMs: 500,
    });
    expect(late.increments[0]!.dVol).toBe(5);
  });
});