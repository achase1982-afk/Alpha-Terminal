import { beforeEach, describe, expect, it } from "vitest";
import {
  spotForChainHolder,
  streamerSubHold,
  streamerSubPlanLevelOneOptions,
  streamerSubResetForTests,
  streamerSubSetUnderlyingSpotResolver,
} from "../streamerSubscriptionManager.js";

function occSpy(strike: number): string {
  const strikePadded = String(Math.round(strike * 1000)).padStart(8, "0");
  return `SPY   251121C${strikePadded}`;
}

describe("spotForChainHolder", () => {
  beforeEach(() => {
    streamerSubResetForTests();
    streamerSubSetUnderlyingSpotResolver(() => null);
  });

  it("uses median strike for SPY chain when no equity quote", () => {
    const keys = [occSpy(610), occSpy(590), occSpy(600)];
    streamerSubHold("stream:c:chain:chain:SPY:abc", "user_visible", "LEVELONE_OPTIONS", keys);
    const plan = streamerSubPlanLevelOneOptions().appSubscribed;
    expect(plan[0]).toBe(occSpy(600));
    expect(spotForChainHolder("stream:c:chain:chain:SPY:abc", keys)).toBe(600);
  });
});
