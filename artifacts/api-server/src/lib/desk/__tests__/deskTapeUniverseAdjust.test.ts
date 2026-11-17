import { beforeEach, describe, expect, it } from "vitest";
import {
  deskComputeDeskLevelOneOptionsBudget,
  DESK_LEVELONE_OPTIONS_TARGET,
} from "../deskStreamerBudget.js";
import {
  deskTapeUniverseAdjustToAppPlan,
  deskTapeUniverseSetFullTargetsForTests,
} from "../deskTapeUniverse.js";
import {
  streamerSubDeskCoreOptionKeysList,
  streamerSubHold,
  streamerSubMaxDeskOptionKeys,
  streamerSubRelease,
  streamerSubResetForTests,
  streamerSubSetDeskCore,
} from "../../streamerSubscriptionManager.js";

describe("deskTapeUniverseAdjustToAppPlan", () => {
  beforeEach(() => {
    streamerSubResetForTests();
    process.env.DESK_TAPE_UNIVERSE_ENABLED = "1";
    const full = Array.from({ length: DESK_LEVELONE_OPTIONS_TARGET }, (_, i) => `DESK-${i}`);
    deskTapeUniverseSetFullTargetsForTests(full, []);
    streamerSubSetDeskCore("LEVELONE_OPTIONS", full.slice(0, deskComputeDeskLevelOneOptionsBudget(600)));
    streamerSubHold(
      "stream:test:chain:chain:SPY:x",
      "user_visible",
      "LEVELONE_OPTIONS",
      Array.from({ length: 600 }, (_, i) => `APP-${i}`),
    );
  });

  it("grows desk back to 2822 after a 600-key chain hold is released", async () => {
    expect(streamerSubMaxDeskOptionKeys()).toBe(deskComputeDeskLevelOneOptionsBudget(600));
    await streamerSubRelease("stream:test:chain:chain:SPY:x");
    await deskTapeUniverseAdjustToAppPlan();
    expect(streamerSubMaxDeskOptionKeys()).toBe(deskComputeDeskLevelOneOptionsBudget(0));
    expect(streamerSubDeskCoreOptionKeysList().length).toBe(DESK_LEVELONE_OPTIONS_TARGET);
  });
});
