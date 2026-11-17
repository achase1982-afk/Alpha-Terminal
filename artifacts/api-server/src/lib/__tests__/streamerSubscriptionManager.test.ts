import { beforeEach, describe, expect, it } from "vitest";
import {
  getStreamerSubscriptionHealth,
  streamerSubHold,
  streamerSubPlanLevelOneOptions,
  streamerSubRecordRejection,
  streamerSubRelease,
  streamerSubResetForTests,
  streamerSubSetDeskCore,
} from "../streamerSubscriptionManager.js";

describe("streamerSubscriptionManager", () => {
  beforeEach(() => streamerSubResetForTests());

  it("plans desk core before user_visible holds", () => {
    streamerSubSetDeskCore("LEVELONE_OPTIONS", ["DESK-CORE"]);
    streamerSubHold("chain:spx", "user_visible", "LEVELONE_OPTIONS", ["USER-A"]);
    const plan = streamerSubPlanLevelOneOptions();
    expect(plan.subscribed).toContain("DESK-CORE");
    expect(plan.subscribed).toContain("USER-A");
  });

  it("release clears holder", () => {
    streamerSubHold("chain:spx", "user_visible", "LEVELONE_OPTIONS", ["ONLY-ME"]);
    expect(streamerSubRelease("chain:spx")).toBe(true);
    expect(streamerSubRelease("chain:spx")).toBe(false);
  });

  it("records rejections in health", () => {
    streamerSubRecordRejection("LEVELONE_OPTIONS", "BADKEY", "cap");
    const h = getStreamerSubscriptionHealth();
    expect(h.streamer_add_rejections[0]?.key).toBe("BADKEY");
  });
});