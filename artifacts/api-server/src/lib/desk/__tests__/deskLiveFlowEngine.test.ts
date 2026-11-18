import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  deskLiveFlowEmittedFramesForTests,
  deskLiveFlowReplayL1o,
  deskLiveFlowResetEngineForTests,
  deskLiveFlowOnUwNetPremRows,
} from "../deskLiveFlowEngine.js";
import { deskLiveFlowResetSeqForTests } from "../deskLiveFlowHub.js";

vi.mock("../deskLiveFlowConfig.js", () => ({
  deskLiveFlowPxEnabled: () => true,
  deskLiveFlowL1oEnabled: () => true,
  deskLiveFlowUwBarsEnabled: () => true,
  DESK_LIVE_FLOW_PX_MAX_PER_SEC: 4,
}));

vi.mock("../deskLiveFlowHub.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../deskLiveFlowHub.js")>();
  return {
    ...actual,
    deskLiveFlowBroadcastFrame: vi.fn(),
  };
});

describe("deskLiveFlowEngine replay", () => {
  beforeEach(() => {
    deskLiveFlowResetEngineForTests();
    deskLiveFlowResetSeqForTests();
  });

  it("aggregates 1s call buy into flow_1s", () => {
    const frames = deskLiveFlowReplayL1o([
      { key: "SPXW  261117C05000000", fields: { 2: 1, 3: 2, 4: 1.5, 8: 0 }, rxMs: 10_000 },
      { key: "SPXW  261117C05000000", fields: { 4: 2, 8: 10 }, rxMs: 10_500 },
      { key: "SPXW  261117C05000000", fields: { 4: 2, 8: 10 }, rxMs: 11_200 },
    ]);
    const flow1 = frames.find((f) => f.type === "flow_1s");
    expect(flow1).toBeDefined();
    expect(flow1!.call_buy).toBe(10 * 2 * 100);
    expect(flow1!.bucket_ms).toBe(10_000);
    expect(flow1!.n_contracts).toBe(1);
  });

  it("emits monotonic seq without gaps", () => {
    const frames = deskLiveFlowReplayL1o([
      { key: "SPXW  261117C05000000", fields: { 2: 1, 3: 2, 4: 2, 8: 0 }, rxMs: 20_000 },
      { key: "SPXW  261117C05000000", fields: { 4: 2, 8: 3 }, rxMs: 20_100 },
      { key: "SPXW  261117C05000000", fields: { 4: 2, 8: 3 }, rxMs: 61_000 },
    ]);
    const seqs = frames.map((f) => f.seq);
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]).toBe(seqs[i - 1]! + 1);
    }
  });

  it("dedupes uw_np_bar by bar_start_ms", () => {
    deskLiveFlowResetEngineForTests();
    const row = {
      tape_time: "2025-03-21T19:58:00.000Z",
      net_call_premium: "100",
      net_put_premium: "-200",
    };
    deskLiveFlowOnUwNetPremRows([row, row], "SPX", 1_700_000_000_000);
    const bars = deskLiveFlowEmittedFramesForTests().filter((f) => f.type === "uw_np_bar");
    expect(bars).toHaveLength(1);
  });
});