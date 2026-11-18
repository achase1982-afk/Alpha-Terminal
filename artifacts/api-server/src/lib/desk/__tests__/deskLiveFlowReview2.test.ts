import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { bucketDueToClose, DESK_LIVE_FLOW_BUCKET_CLOSE_MS } from "../deskLiveFlowBuckets.js";
import {
  deskLiveFlowBucketTick,
  deskLiveFlowEmitPx,
  deskLiveFlowOnL1oRows,
  deskLiveFlowResetEngineForTests,
} from "../deskLiveFlowEngine.js";
import { deskLiveFlowBucketsResetForTests } from "../deskLiveFlowBuckets.js";
import {
  deskLiveFlowTapeFlush,
  deskLiveFlowTapeOnEquityL1,
  deskLiveFlowTapeOnFuturesL1,
  deskLiveFlowTapeOnSessionReset,
  deskLiveFlowTapeResetForTests,
} from "../deskLiveFlowTape.js";
import { deskLiveFlowSubsAcquire, deskLiveFlowSubsResetForTests, deskLiveFlowSubsWouldBeNewSymbol } from "../deskLiveFlowSubs.js";
import { deskLiveFlowCanSubscribe, deskLiveFlowRejectSymbol } from "../deskLiveFlowLimits.js";
import { deskLiveFlowTestResetFrames, deskLiveFlowTestSliceFrames } from "../deskLiveFlowTestBuffer.js";
import { deskLiveFlowResetSeqForTests } from "../deskLiveFlowHub.js";

vi.mock("../deskLiveFlowConfig.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../deskLiveFlowConfig.js")>();
  return {
    ...actual,
    deskLiveFlowEnabled: () => true,
    deskLiveFlowL1oEnabled: () => true,
    deskLiveFlowPxEnabled: () => true,
    DESK_LIVE_FLOW_PX_MAX_PER_SEC: 2,
  };
});

vi.mock("../deskLiveFlowHub.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../deskLiveFlowHub.js")>();
  return { ...actual, deskLiveFlowBroadcastFrame: vi.fn() };
});

vi.mock("../../schwabStreamer.js", () => ({
  deskFlowStreamerEnsureEquityL1: () => true,
  deskFlowStreamerEnsureTimesaleEquity: () => true,
  deskFlowStreamerReleaseEquityL1: vi.fn(),
  deskFlowStreamerReleaseTimesaleEquity: vi.fn(),
  deskFlowStreamerEnsureFuturesL1: () => true,
  deskFlowStreamerEnsureTimesaleFutures: () => true,
  deskFlowStreamerReleaseFuturesL1: vi.fn(),
  deskFlowStreamerReleaseTimesaleFutures: vi.fn(),
  getAppLevelOneEquitiesCount: () => 0,
}));

const KEY = "SPXW  261117C05000000";

describe("deskLiveFlow review round 2", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    deskLiveFlowResetEngineForTests();
    deskLiveFlowResetSeqForTests();
    deskLiveFlowTestResetFrames();
    deskLiveFlowBucketsResetForTests();
    deskLiveFlowTapeResetForTests();
    deskLiveFlowSubsResetForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("closes 60s bar after minute end + lag, not at minute start", () => {
    expect(bucketDueToClose(0, 1_350, 60_000)).toBe(false);
    expect(bucketDueToClose(0, 60_000 + DESK_LIVE_FLOW_BUCKET_CLOSE_MS, 60_000)).toBe(true);
  });

  it("emits flow_60s only once for a minute after full window", () => {
    deskLiveFlowOnL1oRows([{ key: KEY, 2: 1, 3: 2, 4: 2, 8: 10 }], 1_000);
    const before = deskLiveFlowTestSliceFrames(0).length;
    deskLiveFlowBucketTick(1_350);
    let after = deskLiveFlowTestSliceFrames(before);
    expect(after.filter((f) => f.type === "flow_60s")).toHaveLength(0);
    deskLiveFlowOnL1oRows([{ key: KEY, 2: 1, 3: 2, 4: 2, 8: 15 }], 30_000);
    deskLiveFlowBucketTick(60_000 + DESK_LIVE_FLOW_BUCKET_CLOSE_MS + 10);
    after = deskLiveFlowTestSliceFrames(before);
    const flow60 = after.filter((f) => f.type === "flow_60s");
    expect(flow60).toHaveLength(1);
    deskLiveFlowOnL1oRows([{ key: KEY, 2: 1, 3: 2, 4: 2, 8: 20 }], 62_000);
    deskLiveFlowBucketTick(62_500);
    after = deskLiveFlowTestSliceFrames(before);
    expect(after.filter((f) => f.type === "flow_60s")).toHaveLength(1);
  });

  it("classifies L1 fallback lift against previous quote as buy", () => {
    deskLiveFlowSubsAcquire("AAPL", "equity");
    deskLiveFlowTapeOnEquityL1("AAPL", { 1: 229, 2: 229.5, 3: 229.48, 8: 1000 }, 1_000);
    deskLiveFlowTapeOnEquityL1("AAPL", { 1: 229.49, 2: 229.55, 3: 229.52, 8: 1500 }, 1_100);
    deskLiveFlowTapeFlush("AAPL", 1_100);
    const frames = deskLiveFlowTestSliceFrames(0);
    const tape = frames.find((f) => f.type === "tape_1s");
    expect(tape?.buy_vol).toBe(500);
    expect(tape?.sell_vol ?? 0).toBe(0);
  });

  it("symbol cap blocks new symbols but allows held", () => {
    for (let i = 0; i < 8; i++) deskLiveFlowSubsAcquire(`SYM${i}`, "equity");
    expect(deskLiveFlowCanSubscribe("SYM0", "equity").ok).toBe(true);
    expect(deskLiveFlowCanSubscribe("SYM9", "equity").ok).toBe(false);
    expect(deskLiveFlowSubsWouldBeNewSymbol("SYM0", "equity")).toBe(false);
  });

  it("rejects junk tickers and unknown futures roots", () => {
    expect(deskLiveFlowRejectSymbol("QWERTY", "equity")).toBe("invalid_symbol");
    expect(deskLiveFlowRejectSymbol("/QQQQQ", "futures")).toBe("invalid_futures_symbol");
    expect(deskLiveFlowRejectSymbol("/ES", "futures")).toBeNull();
  });

  it("never emits px with older src_ts after a newer one", () => {
    deskLiveFlowEmitPx("$SPX", { 3: 7350, 1: 7349, 2: 7351, 34: 10_000 }, 10_000);
    deskLiveFlowEmitPx("$SPX", { 3: 7344, 1: 7343, 2: 7345, 34: 9_900 }, 10_050);
    deskLiveFlowEmitPx("$SPX", { 3: 7352, 1: 7351, 2: 7353, 34: 10_100 }, 10_100);
    vi.advanceTimersByTime(300);
    const px = deskLiveFlowTestSliceFrames(0).filter((f) => f.type === "px");
    const srcTs = px.map((f) => f.src_ts_ms as number);
    for (let i = 1; i < srcTs.length; i++) {
      expect(srcTs[i]).toBeGreaterThanOrEqual(srcTs[i - 1]!);
    }
    expect(px.some((f) => f.last === 7344)).toBe(false);
  });

  it("resets futures tape session state on reconnect", () => {
    deskLiveFlowSubsAcquire("/MES", "futures");
    deskLiveFlowTapeOnFuturesL1("/MES", { 1: 6800, 2: 6800.5, 3: 6800.25, 8: 100 }, 1_000);
    deskLiveFlowTapeOnSessionReset();
    deskLiveFlowTapeOnFuturesL1("/MES", { 1: 6800, 2: 6800.5, 3: 6800.25, 8: 110 }, 2_000);
    const frames = deskLiveFlowTestSliceFrames(0).filter((f) => f.type === "tape_1s");
    expect(frames.length).toBeLessThanOrEqual(1);
  });
});