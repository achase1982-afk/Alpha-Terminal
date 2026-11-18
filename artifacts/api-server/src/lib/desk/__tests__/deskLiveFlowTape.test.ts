import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  deskLiveFlowTapeReplayPrints,
  deskLiveFlowTapeResetForTests,
} from "../deskLiveFlowTape.js";
import { deskLiveFlowSubsAcquire, deskLiveFlowSubsResetForTests } from "../deskLiveFlowSubs.js";
import { deskLiveFlowResetSeqForTests } from "../deskLiveFlowHub.js";

vi.mock("../deskLiveFlowConfig.js", () => ({
  deskLiveFlowEnabled: () => true,
  DESK_LIVE_FLOW_PX_MAX_PER_SEC: 4,
}));

vi.mock("../deskLiveFlowHub.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../deskLiveFlowHub.js")>();
  return {
    ...actual,
    deskLiveFlowBroadcastFrame: vi.fn(),
  };
});

vi.mock("../../schwabStreamer.js", () => ({
  deskFlowStreamerEnsureEquityL1: () => false,
  deskFlowStreamerEnsureTimesaleEquity: () => false,
  deskFlowStreamerReleaseEquityL1: vi.fn(),
  deskFlowStreamerReleaseTimesaleEquity: vi.fn(),
  deskFlowStreamerEnsureFuturesL1: () => false,
  deskFlowStreamerEnsureTimesaleFutures: () => false,
  deskFlowStreamerReleaseFuturesL1: vi.fn(),
  deskFlowStreamerReleaseTimesaleFutures: vi.fn(),
}));

describe("deskLiveFlowTape", () => {
  beforeEach(() => {
    deskLiveFlowTapeResetForTests();
    deskLiveFlowSubsResetForTests();
    deskLiveFlowResetSeqForTests();
    deskLiveFlowSubsAcquire("NVDA", "equity");
  });

  it("classifies buyer lifting ask into buy_vol and buy_$", () => {
    const frames = deskLiveFlowTapeReplayPrints("NVDA", "equity", [
      { price: 140, size: 100, rxMs: 5_000, bid: 139.5, ask: 140 },
      { price: 140.5, size: 50, rxMs: 5_200, bid: 139.5, ask: 140 },
    ]);
    const tape = frames.find((f) => f.type === "tape_1s");
    expect(tape).toBeDefined();
    expect(tape!.buy_vol).toBe(150);
    expect(tape!.sell_vol).toBe(0);
    expect(tape!.buy_$).toBe(140 * 100 + 140.5 * 50);
    expect(tape!.src).toBe("schwab_timesale");
  });

  it("marks seller hitting bid", () => {
    const frames = deskLiveFlowTapeReplayPrints("NVDA", "equity", [
      { price: 139.5, size: 200, rxMs: 10_000, bid: 139.5, ask: 140 },
    ]);
    const tape = frames.find((f) => f.type === "tape_1s");
    expect(tape!.sell_vol).toBe(200);
    expect(tape!.sell_$).toBe(139.5 * 200);
  });

  it("aggregates mid prints", () => {
    const frames = deskLiveFlowTapeReplayPrints("NVDA", "equity", [
      { price: 139.75, size: 80, rxMs: 15_000, bid: 139.5, ask: 140 },
    ]);
    const tape = frames.find((f) => f.type === "tape_1s");
    expect(tape!.mid_vol).toBe(80);
  });
});