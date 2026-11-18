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
  deskLiveFlowTapeBucketTick,
  deskLiveFlowTapeFlush,
  deskLiveFlowTapeOnTimesaleEquity,
  deskLiveFlowTapeReplayPrints,
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

  it("rejects junk tickers and unsupported futures roots with supported list", () => {
    expect(deskLiveFlowRejectSymbol("QWERTY", "equity")?.error).toBe("invalid_symbol");
    const cl = deskLiveFlowRejectSymbol("/CL", "futures");
    expect(cl?.error).toBe("futures_flow_unsupported");
    expect(cl?.supported).toContain("/ES");
    expect(deskLiveFlowRejectSymbol("/ES", "futures")).toBeNull();
    expect(deskLiveFlowRejectSymbol("/ESZ26", "futures")).toBeNull();
  });

  it("emits trade px on direct path when trade srcTs is older than quote srcTs", () => {
    deskLiveFlowEmitPx("$SPX", { 1: 7349, 2: 7351, 3: 7350, 34: 10_000 }, 10_000);
    deskLiveFlowEmitPx("$SPX", { 3: 7353, 35: 9_950 }, 10_050);
    const px = deskLiveFlowTestSliceFrames(0).filter((f) => f.type === "px");
    expect(px.some((f) => f.last === 7353)).toBe(true);
    expect(px.at(-1)?.last).toBe(7353);
  });

  it("drops stale trailing px with older src_ts after a newer direct send", () => {
    for (let i = 0; i < 5; i++) {
      deskLiveFlowEmitPx(
        "$SPX",
        { 3: 7350 + i, 1: 7349, 2: 7351, 34: 10_000 + i * 10 },
        10_000 + i * 5,
      );
    }
    deskLiveFlowEmitPx("$SPX", { 3: 7360, 1: 7359, 2: 7361, 34: 10_100 }, 10_100);
    vi.advanceTimersByTime(300);
    const px = deskLiveFlowTestSliceFrames(0).filter((f) => f.type === "px");
    expect(px.some((f) => f.last === 7353 && (f.src_ts_ms as number) < 10_090)).toBe(false);
  });

  it("probe: 500+800 then late 300 tradeMs 900@rx1300 counts 1600 total", () => {
    deskLiveFlowSubsAcquire("NVDA", "equity");
    const frames = deskLiveFlowTapeReplayPrints("NVDA", "equity", [
      { price: 10, size: 500, rxMs: 1_000, bid: 9.9, ask: 10, tradeMs: 500, seq: 1 },
      { price: 10, size: 800, rxMs: 1_100, bid: 9.9, ask: 10, tradeMs: 1_000, seq: 2 },
      { price: 10, size: 300, rxMs: 1_300, bid: 9.9, ask: 10, tradeMs: 900, seq: 3 },
    ]);
    const vol = frames
      .filter((f) => f.type === "tape_1s")
      .reduce(
        (n, f) => n + Number(f.buy_vol ?? 0) + Number(f.sell_vol ?? 0) + Number(f.mid_vol ?? 0),
        0,
      );
    expect(vol).toBe(1600);
  });

  it("probe: after bucket 1000 emitted, late 50 for that second folds into current open", () => {
    deskLiveFlowSubsAcquire("NVDA", "equity");
    deskLiveFlowTapeOnEquityL1("NVDA", { 1: 9.9, 2: 10, 3: 10 }, 1_000);
    deskLiveFlowTapeReplayPrints("NVDA", "equity", [
      { price: 10, size: 200, rxMs: 1_500, bid: 9.9, ask: 10, tradeMs: 1_000, seq: 1 },
    ]);
    deskLiveFlowTapeBucketTick(1_000 + 1_000 + 1_100);
    vi.setSystemTime(2_500);
    deskLiveFlowTapeOnTimesaleEquity("NVDA", 10, 50, 1_050, 2);
    deskLiveFlowTapeFlush("NVDA", 2_500);
    const vol = deskLiveFlowTestSliceFrames(0)
      .filter((f) => f.type === "tape_1s")
      .reduce(
        (n, f) => n + Number(f.buy_vol ?? 0) + Number(f.sell_vol ?? 0) + Number(f.mid_vol ?? 0),
        0,
      );
    expect(vol).toBe(250);
  });

  it("probe: late print folds into open bucket before first emit", () => {
    deskLiveFlowSubsAcquire("NVDA", "equity");
    const frames = deskLiveFlowTapeReplayPrints("NVDA", "equity", [
      { price: 10, size: 100, rxMs: 2_000, bid: 9.9, ask: 10, tradeMs: 2_000, seq: 1 },
      { price: 10, size: 50, rxMs: 2_050, bid: 9.9, ask: 10, tradeMs: 1_900, seq: 2 },
    ]);
    const tape = frames.find((f) => f.type === "tape_1s");
    const vol =
      Number(tape?.buy_vol ?? 0) + Number(tape?.sell_vol ?? 0) + Number(tape?.mid_vol ?? 0);
    expect(vol).toBe(150);
    expect(tape?.bucket_ms).toBe(2_000);
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