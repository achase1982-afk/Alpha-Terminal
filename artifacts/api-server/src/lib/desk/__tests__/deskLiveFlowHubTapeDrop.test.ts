import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __deskLiveFlowOnClientDisconnectForTests,
  deskLiveFlowResetSeqForTests,
} from "../deskLiveFlowHub.js";
import {
  deskLiveFlowSubsAcquire,
  deskLiveFlowSubsResetForTests,
  deskLiveFlowSubsSymbolActive,
} from "../deskLiveFlowSubs.js";
import * as deskLiveFlowTape from "../deskLiveFlowTape.js";
import { deskLiveFlowTestFrameCount, deskLiveFlowTestResetFrames } from "../deskLiveFlowTestBuffer.js";

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

vi.mock("../deskLiveFlowConfig.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../deskLiveFlowConfig.js")>();
  return { ...actual, deskLiveFlowEnabled: () => true };
});

describe("deskLiveFlowHub tape drop on disconnect", () => {
  beforeEach(() => {
    deskLiveFlowSubsResetForTests();
    deskLiveFlowTape.deskLiveFlowTapeResetForTests();
    deskLiveFlowResetSeqForTests();
    deskLiveFlowTestResetFrames();
    vi.restoreAllMocks();
  });

  it("keeps tape state when a second client shares the same wire key", () => {
    const dropSpy = vi.spyOn(deskLiveFlowTape, "deskLiveFlowTapeDropSymbol");
    deskLiveFlowSubsAcquire("BRK.B", "equity");
    deskLiveFlowSubsAcquire("BRK/B", "equity");

    __deskLiveFlowOnClientDisconnectForTests("BRK.B", "equity");
    expect(deskLiveFlowSubsSymbolActive("BRK/B", "equity")).toBe(true);
    expect(dropSpy).not.toHaveBeenCalled();
  });

  it("drops tape only after the last holder of a wire key disconnects", () => {
    const dropSpy = vi.spyOn(deskLiveFlowTape, "deskLiveFlowTapeDropSymbol");
    deskLiveFlowSubsAcquire("BRK.B", "equity");
    deskLiveFlowTape.deskLiveFlowTapeOnEquityL1("BRK/B", { 1: 612, 2: 613, 3: 612.5, 8: 1 }, 1_000);
    __deskLiveFlowOnClientDisconnectForTests("BRK.B", "equity");
    expect(deskLiveFlowSubsSymbolActive("BRK.B", "equity")).toBe(false);
    expect(dropSpy).toHaveBeenCalledWith("BRK.B", "equity");
    const before = deskLiveFlowTestFrameCount();
    deskLiveFlowTape.deskLiveFlowTapeOnEquityL1("BRK/B", { 1: 612, 2: 613, 3: 613, 8: 2 }, 1_100);
    expect(deskLiveFlowTestFrameCount()).toBe(before);
  });
});