import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import {
  deskLiveFlowReplayL1o,
  deskLiveFlowResetEngineForTests,
  deskLiveFlowOnUwNetPremRows,
  deskLiveFlowOnStreamerSessionReset,
  deskLiveFlowOnContractsRebaseline,
  deskLiveFlowOnL1oRows,
  deskLiveFlowBucketTick,
  deskLiveFlowContractStateForTests,
} from "../deskLiveFlowEngine.js";
import { deskLiveFlowResetSeqForTests } from "../deskLiveFlowHub.js";
import {
  deskLiveFlowTestFrameCount,
  deskLiveFlowTestResetFrames,
  deskLiveFlowTestSliceFrames,
} from "../deskLiveFlowTestBuffer.js";
import { deskLiveFlowBucketsResetForTests } from "../deskLiveFlowBuckets.js";
import { deskLiveFlowSessionResetForTests } from "../deskLiveFlowSession.js";

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

const KEY = "SPXW  261117C05000000";

describe("deskLiveFlowEngine replay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    deskLiveFlowResetEngineForTests();
    deskLiveFlowResetSeqForTests();
    deskLiveFlowTestResetFrames();
    deskLiveFlowBucketsResetForTests();
    deskLiveFlowSessionResetForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("aggregates 1s call buy into flow_1s", () => {
    const frames = deskLiveFlowReplayL1o([
      { key: KEY, fields: { 2: 1, 3: 2, 4: 1.5, 8: 0 }, rxMs: 10_000 },
      { key: KEY, fields: { 4: 2, 8: 10 }, rxMs: 10_500 },
      { key: KEY, fields: { 4: 2, 8: 10 }, rxMs: 11_200 },
    ]);
    const flow1 = frames.find((f) => f.type === "flow_1s");
    expect(flow1).toBeDefined();
    expect(flow1!.call_buy).toBe(10 * 2 * 100);
    expect(flow1!.bucket_ms).toBe(10_000);
  });

  it("does not fake a burst after session reconnect baseline", () => {
    deskLiveFlowReplayL1o([{ key: KEY, fields: { 2: 1, 3: 2, 4: 2, 8: 5000 }, rxMs: 1_000 }]);
    deskLiveFlowOnStreamerSessionReset("reconnect");
    const frames = deskLiveFlowReplayL1o([{ key: KEY, fields: { 2: 1, 3: 2, 4: 2, 8: 5000 }, rxMs: 2_000 }]);
    expect(frames.filter((f) => f.type === "flow_1s")).toHaveLength(0);
  });

  it("re-baselines on contract re-add without burst", () => {
    deskLiveFlowReplayL1o([{ key: KEY, fields: { 2: 1, 3: 2, 4: 2, 8: 100 }, rxMs: 1_000 }]);
    deskLiveFlowOnContractsRebaseline([KEY]);
    const st = deskLiveFlowContractStateForTests().get(KEY);
    expect(st?.prevVolume).toBe(100);
    expect(st?.prevBid).toBeNull();
    const frames = deskLiveFlowReplayL1o([{ key: KEY, fields: { 2: 1, 3: 2, 4: 2, 8: 100 }, rxMs: 2_000 }]);
    expect(frames.filter((f) => f.type === "flow_1s")).toHaveLength(0);
  });

  it("closes 1s bucket on timer without waiting for next trade", () => {
    deskLiveFlowOnL1oRows(
      [{ key: KEY, 2: 1, 3: 2, 4: 2, 8: 0 }],
      5_000,
    );
    deskLiveFlowOnL1oRows([{ key: KEY, 2: 1, 3: 2, 4: 2, 8: 5 }], 5_100);
    const before = deskLiveFlowTestFrameCount();
    deskLiveFlowBucketTick(7_200);
    const after = deskLiveFlowTestSliceFrames(before);
    expect(after.some((f) => f.type === "flow_1s" || f.type === "flow_heartbeat")).toBe(true);
  });

  it("re-sends revised uw_np_bar for same bar_start_ms", () => {
    const row = {
      tape_time: "2025-03-21T19:58:00.000Z",
      net_call_premium: "100",
      net_put_premium: "-200",
    };
    deskLiveFlowOnUwNetPremRows([row], "SPX", 1_000);
    deskLiveFlowOnUwNetPremRows(
      [{ ...row, net_call_premium: "150" }],
      "SPX",
      2_000,
    );
    const bars = deskLiveFlowTestSliceFrames(0).filter((f) => f.type === "uw_np_bar");
    expect(bars).toHaveLength(2);
  });
});