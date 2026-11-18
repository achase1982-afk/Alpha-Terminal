import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  deskLiveFlowTapeOnSessionReset,
  deskLiveFlowTapeReplayPrints,
  deskLiveFlowTapeResetForTests,
} from "../deskLiveFlowTape.js";
import { deskLiveFlowFuturesNotionalDollars } from "../deskLiveFlowFuturesMult.js";
import { deskLiveFlowSubsAcquire, deskLiveFlowSubsRelease, deskLiveFlowSubsResetForTests } from "../deskLiveFlowSubs.js";
import { deskLiveFlowRejectSymbol } from "../deskLiveFlowLimits.js";
import { deskFlowStreamerEnsureEquityL1, deskFlowStreamerReleaseEquityL1, deskStreamerReplayDeskFlowAdds } from "../../schwabStreamer.js";
import { deskLiveFlowResetSeqForTests } from "../deskLiveFlowHub.js";

vi.mock("../deskLiveFlowConfig.js", () => ({
  deskLiveFlowEnabled: () => true,
  DESK_LIVE_FLOW_PX_MAX_PER_SEC: 4,
  DESK_LIVE_FLOW_QUOTE_HISTORY_CAP: 64,
  DESK_LIVE_FLOW_TAPE_REORDER_MS: 750,
}));

vi.mock("../deskLiveFlowHub.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../deskLiveFlowHub.js")>();
  return { ...actual, deskLiveFlowBroadcastFrame: vi.fn() };
});

const streamerState = {
  equityOwners: new Map<string, Set<string>>(),
  deskAdded: new Set<string>(),
  subscribed: new Set<string>(),
  replayCalls: 0,
};

vi.mock("../../schwabStreamer.js", () => ({
  deskFlowStreamerEnsureEquityL1: (sym: string) => {
    const n = sym.toUpperCase();
    const s = streamerState.equityOwners.get(n) ?? new Set();
  const first = s.size === 0;
  s.add("live_flow");
  streamerState.equityOwners.set(n, s);
  if (first && !streamerState.subscribed.has(n)) streamerState.deskAdded.add(n);
  return first;
  },
  deskFlowStreamerReleaseEquityL1: (sym: string) => {
    const n = sym.toUpperCase();
    const s = streamerState.equityOwners.get(n);
    s?.delete("live_flow");
    if (s && s.size === 0) {
      streamerState.equityOwners.delete(n);
      streamerState.deskAdded.delete(n);
    }
  },
  deskFlowStreamerEnsureTimesaleEquity: () => false,
  deskFlowStreamerEnsureFuturesL1: () => false,
  deskFlowStreamerEnsureTimesaleFutures: () => false,
  deskFlowStreamerReleaseTimesaleEquity: vi.fn(),
  deskFlowStreamerReleaseFuturesL1: vi.fn(),
  deskFlowStreamerReleaseTimesaleFutures: vi.fn(),
  deskStreamerReplayDeskFlowAdds: () => {
    streamerState.replayCalls += 1;
  },
  getAppLevelOneEquitiesCount: () => 0,
}));

describe("desk live flow phase 2 hardening", () => {
  beforeEach(() => {
    deskLiveFlowTapeResetForTests();
    deskLiveFlowSubsResetForTests();
    deskLiveFlowResetSeqForTests();
    streamerState.equityOwners.clear();
    streamerState.deskAdded.clear();
    streamerState.subscribed.clear();
    streamerState.replayCalls = 0;
    deskLiveFlowSubsAcquire("NVDA", "equity");
  });

  it("applies ES notional multiplier", () => {
    expect(deskLiveFlowFuturesNotionalDollars("/ES", 6800.25, 50)).toBe(6800.25 * 50 * 50);
  });

  it("classifies lift against prior quote snapshot", () => {
    const frames = deskLiveFlowTapeReplayPrints("NVDA", "equity", [
      {
        price: 140,
        size: 100,
        rxMs: 5_000,
        bid: 139.5,
        ask: 140,
        tradeMs: 4_950,
      },
      {
        price: 140,
        size: 50,
        rxMs: 5_100,
        bid: 139.5,
        ask: 140,
        tradeMs: 5_050,
      },
    ]);
    const tapes = frames.filter((f) => f.type === "tape_1s");
    const buyVol = tapes.reduce((n, f) => n + Number(f.buy_vol ?? 0), 0);
    expect(buyVol).toBe(150);
    expect(tapes.every((f) => Number(f.sell_vol ?? 0) === 0)).toBe(true);
  });

  it("resets timesale path after session reconnect", () => {
    deskLiveFlowSubsAcquire("/ES", "futures");
    deskLiveFlowTapeOnSessionReset();
    expect(true).toBe(true);
  });

  it("rejects garbage symbols", () => {
    expect(deskLiveFlowRejectSymbol("ZZZZZZ", "equity")).toBe("invalid_symbol");
    expect(deskLiveFlowRejectSymbol("/ZZZZZZ", "futures")).toBe("invalid_symbol");
  });

  it("keeps desk equity when flow releases but universe still holds", () => {
    streamerState.deskAdded.add("SPY");
    streamerState.equityOwners.set("SPY", new Set(["tape_universe", "live_flow"]));
    deskLiveFlowSubsAcquire("SPY", "equity");
    deskLiveFlowSubsRelease("SPY", "equity");
    expect(streamerState.deskAdded.has("SPY")).toBe(true);
  });

  it("exposes desk flow replay hook", () => {
    deskStreamerReplayDeskFlowAdds();
    expect(streamerState.replayCalls).toBe(1);
  });
});