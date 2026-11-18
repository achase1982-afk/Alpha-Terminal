import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  applyL1oFlowTick,
  classifyFlowAgainstPriorQuote,
  rebaselineL1ContractState,
} from "../deskLiveFlowClassify.js";
import { deskLiveFlowEmitPx, deskLiveFlowResetEngineForTests } from "../deskLiveFlowEngine.js";
import { deskLiveFlowTestResetFrames, deskLiveFlowTestSliceFrames } from "../deskLiveFlowTestBuffer.js";

vi.mock("../deskLiveFlowConfig.js", () => ({
  deskLiveFlowPxEnabled: () => true,
  deskLiveFlowL1oEnabled: () => true,
  deskLiveFlowUwBarsEnabled: () => false,
  DESK_LIVE_FLOW_PX_MAX_PER_SEC: 4,
}));

vi.mock("../deskLiveFlowHub.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../deskLiveFlowHub.js")>();
  return { ...actual, deskLiveFlowBroadcastFrame: vi.fn() };
});

describe("deskLiveFlow hardening", () => {
  beforeEach(() => {
    deskLiveFlowResetEngineForTests();
    deskLiveFlowTestResetFrames();
  });

  it("classifies locked/crossed quote as unclassified", () => {
    expect(classifyFlowAgainstPriorQuote(10, 0, 5)).toBeNull();
    expect(classifyFlowAgainstPriorQuote(10, 5, 4)).toBeNull();
  });

  it("ignores out-of-order lower volume without resetting baseline", () => {
    const prev = { prevBid: 1, prevAsk: 2, prevVolume: 100, prevLast: 1.5 };
    const { increments, next } = applyL1oFlowTick(prev, {
      key: "K",
      optionSide: "call",
      bid: 1,
      ask: 2,
      last: 1.5,
      volume: 70,
      rxMs: 1,
    });
    expect(increments).toHaveLength(0);
    expect(next.prevVolume).toBe(100);
  });

  it("merges partial px with last known values", () => {
    deskLiveFlowEmitPx("$SPX", { 3: 7330, 1: 7329, 2: 7331 }, 1_000);
    deskLiveFlowEmitPx("$SPX", { 3: 7331 }, 1_100);
    const px = deskLiveFlowTestSliceFrames(0).filter((f) => f.type === "px");
    expect(px.at(-1)?.bid).toBe(7329);
    expect(px.at(-1)?.ask).toBe(7331);
  });

  it("rebaseline keeps volume only", () => {
    const st = rebaselineL1ContractState(42);
    expect(st.prevVolume).toBe(42);
    expect(st.prevBid).toBeNull();
  });
});