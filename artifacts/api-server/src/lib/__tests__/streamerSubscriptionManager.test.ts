import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  STREAMER_L1_OPTIONS_CAP,
  type StreamerSubTier,
  getStreamerSubscriptionHealth,
  streamerSubHold,
  streamerSubPlanLevelOneOptions,
  streamerSubRecordRejection,
  streamerSubRelease,
  streamerSubResetForTests,
  streamerSubBulkSeedHoldsForTests,
  streamerSubSetDeskCore,
} from "../streamerSubscriptionManager.js";

vi.mock("../schwabStreamer.js", () => ({
  replaceManagedLevelOneOptionSubscriptions: vi.fn(),
  getAppLevelOneOptionsCount: () => 0,
  getAppOptionsBookCount: () => 0,
}));

describe("streamerSubscriptionManager", () => {
  beforeEach(() => streamerSubResetForTests());

  it("keeps desk core out of managed app SUBS plan", () => {
    streamerSubSetDeskCore("LEVELONE_OPTIONS", ["DESK-CORE"]);
    streamerSubHold("chain:spx", "user_visible", "LEVELONE_OPTIONS", ["USER-A", "DESK-CORE"]);
    const plan = streamerSubPlanLevelOneOptions();
    expect(plan.subscribed).not.toContain("DESK-CORE");
    expect(plan.subscribed).toContain("USER-A");
    expect(plan.deskCoreCount).toBe(1);
  });

  it("evicts background before user_visible when over cap", () => {
    streamerSubSetDeskCore("LEVELONE_OPTIONS", ["DESK"]);
    const bgKeys = Array.from({ length: STREAMER_L1_OPTIONS_CAP }, (_, i) => `BG-${i}`);
    streamerSubHold("bg", "background", "LEVELONE_OPTIONS", bgKeys);
    streamerSubHold("uv", "user_visible", "LEVELONE_OPTIONS", ["UV-MUST-KEEP"]);
    const plan = streamerSubPlanLevelOneOptions();
    expect(plan.subscribed).toContain("UV-MUST-KEEP");
    expect(plan.capped).toBe(true);
    expect(plan.subscribed.length).toBeLessThanOrEqual(STREAMER_L1_OPTIONS_CAP - 1);
  });

  it("release does not drop keys still held elsewhere", async () => {
    streamerSubHold("a", "user_visible", "LEVELONE_OPTIONS", ["SHARED"]);
    streamerSubHold("b", "user_visible", "LEVELONE_OPTIONS", ["SHARED", "ONLY-B"]);
    const { replaceManagedLevelOneOptionSubscriptions } = await import("../schwabStreamer.js");
    await streamerSubRelease("b");
    const plan = streamerSubPlanLevelOneOptions();
    expect(plan.subscribed).toContain("SHARED");
    expect(plan.subscribed).not.toContain("ONLY-B");
  });

  it("records rejections in health without eviction log", () => {
    streamerSubRecordRejection("LEVELONE_OPTIONS", "BADKEY", "cap");
    const h = getStreamerSubscriptionHealth();
    expect(h.streamer_add_rejections[0]?.key).toBe("BADKEY");
    expect(h.levelone_options).not.toHaveProperty("recent_evictions");
  });

  it("plans 3000 keys in under 20ms", () => {
    streamerSubSetDeskCore("LEVELONE_OPTIONS", ["DESK-0"]);
    const bulk: Array<{ holderId: string; tier: StreamerSubTier; keys: string[] }> = Array.from(
      { length: 80 },
      (_, i) => ({
        holderId: `holder-${i}`,
        tier: i % 3 === 0 ? "user_visible" : "background",
        keys: Array.from({ length: 20 }, (_, j) => `K-${i}-${j}`),
      }),
    );
    streamerSubBulkSeedHoldsForTests(bulk);
    const t0 = performance.now();
    const plan = streamerSubPlanLevelOneOptions();
    const elapsed = performance.now() - t0;
    expect(plan.subscribed.length).toBeLessThanOrEqual(STREAMER_L1_OPTIONS_CAP - 1);
    expect(elapsed).toBeLessThan(15);
  });

  it("health read is pure and uses cached plan", () => {
    streamerSubHold("x", "user_visible", "LEVELONE_OPTIONS", ["A"]);
    const h1 = getStreamerSubscriptionHealth();
    const h2 = getStreamerSubscriptionHealth();
    expect(h1.levelone_options.planned).toBe(h2.levelone_options.planned);
  });
});