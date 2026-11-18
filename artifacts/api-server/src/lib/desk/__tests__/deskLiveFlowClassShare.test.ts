import { beforeEach, describe, expect, it, vi } from "vitest";
import { deskLiveFlowCanSubscribe, deskLiveFlowRejectSymbol } from "../deskLiveFlowLimits.js";
import { deskLiveFlowResetSeqForTests } from "../deskLiveFlowHub.js";
import {
  deskLiveFlowSubsAcquire,
  deskLiveFlowSubsRelease,
  deskLiveFlowSubsResetForTests,
  deskLiveFlowSubsSymbolActive,
} from "../deskLiveFlowSubs.js";
import { deskLiveFlowTapeOnEquityL1, deskLiveFlowTapeResetForTests } from "../deskLiveFlowTape.js";
import { parseDeskFlowSymbol } from "../deskLiveFlowSymbol.js";

vi.mock("../deskLiveFlowConfig.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../deskLiveFlowConfig.js")>();
  return { ...actual, deskLiveFlowEnabled: () => true };
});

const streamerRelease = {
  equityL1: vi.fn(),
  timesale: vi.fn(),
};

vi.mock("../../schwabStreamer.js", () => ({
  deskFlowStreamerEnsureEquityL1: () => true,
  deskFlowStreamerEnsureTimesaleEquity: () => true,
  deskFlowStreamerReleaseEquityL1: (...args: unknown[]) => streamerRelease.equityL1(...args),
  deskFlowStreamerReleaseTimesaleEquity: (...args: unknown[]) => streamerRelease.timesale(...args),
  deskFlowStreamerEnsureFuturesL1: () => true,
  deskFlowStreamerEnsureTimesaleFutures: () => true,
  deskFlowStreamerReleaseFuturesL1: vi.fn(),
  deskFlowStreamerReleaseTimesaleFutures: vi.fn(),
  getAppLevelOneEquitiesCount: () => 0,
  equityStreamKeyFromCaller: (sym: string) => {
    const u = sym.toUpperCase().trim();
    if (/^[A-Z]{1,5}\.[A-Z]{1,2}$/.test(u)) return u.replace(".", "/");
    return u;
  },
}));

describe("desk live flow class shares", () => {
  beforeEach(() => {
    deskLiveFlowSubsResetForTests();
    deskLiveFlowTapeResetForTests();
    deskLiveFlowResetSeqForTests();
    streamerRelease.equityL1.mockClear();
    streamerRelease.timesale.mockClear();
  });

  it("accepts BRK/B for stream subscribe gate and parsing", () => {
    expect(deskLiveFlowRejectSymbol("BRK/B", "equity")).toBeNull();
    expect(deskLiveFlowCanSubscribe("BRK/B", "equity").ok).toBe(true);
    const p = parseDeskFlowSymbol("BRK/B");
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.parsed.sym).toBe("BRK/B");
  });

  it("routes BRK/B wire ticks to BRK.B subscribers", async () => {
    deskLiveFlowSubsAcquire("BRK.B", "equity");
    expect(deskLiveFlowSubsSymbolActive("BRK/B", "equity")).toBe(true);
    deskLiveFlowTapeOnEquityL1("BRK/B", { 1: 612, 2: 613, 3: 612.5, 8: 900 }, Date.now());
    expect(deskLiveFlowSubsSymbolActive("BRK.B", "equity")).toBe(true);
  });

  it("keeps subscription until both dot and slash forms are released", () => {
    deskLiveFlowSubsAcquire("BRK.B", "equity");
    deskLiveFlowSubsAcquire("BRK/B", "equity");
    expect(deskLiveFlowSubsSymbolActive("BRK.B", "equity")).toBe(true);
    deskLiveFlowSubsRelease("BRK.B", "equity");
    expect(deskLiveFlowSubsSymbolActive("BRK/B", "equity")).toBe(true);
    expect(streamerRelease.equityL1).not.toHaveBeenCalled();
    deskLiveFlowSubsRelease("BRK/B", "equity");
    expect(streamerRelease.equityL1).toHaveBeenCalledTimes(1);
  });

  it("leaves SPX and /ES paths unchanged", () => {
    expect(deskLiveFlowRejectSymbol("SPX", "spx")).toBeNull();
    expect(deskLiveFlowRejectSymbol("/ES", "futures")).toBeNull();
    expect(deskLiveFlowRejectSymbol("NVDA", "equity")).toBeNull();
    expect(deskLiveFlowRejectSymbol("./ES", "equity")?.error).toBe("invalid_symbol");
  });
});