import { beforeEach, describe, expect, it } from "vitest";
import {
  streamerSubHold,
  streamerSubPlanLevelOneOptions,
  streamerSubRelease,
  streamerSubResetForTests,
  streamerSubSetUnderlyingSpotResolver,
} from "../streamerSubscriptionManager.js";

function occSpy(strike: number): string {
  const strikePadded = String(Math.round(strike * 1000)).padStart(8, "0");
  return `SPY   251121C${strikePadded}`;
}

describe("streamerSub app plan priority", () => {
  beforeEach(() => {
    streamerSubResetForTests();
    streamerSubSetUnderlyingSpotResolver(() => 600);
  });

  it("puts ticket legs before chain under stream holder ids", async () => {
    streamerSubHold("stream:client-a:ticket:ticket:SPY:abc", "user_visible", "LEVELONE_OPTIONS", [
      occSpy(500),
    ]);
    streamerSubHold("stream:client-a:chain:chain:SPY:def", "user_visible", "LEVELONE_OPTIONS", [
      occSpy(600),
      occSpy(590),
    ]);
    const plan = streamerSubPlanLevelOneOptions().appSubscribed;
    expect(plan[0]).toBe(occSpy(500));
    expect(plan.includes(occSpy(600))).toBe(true);
  });
});
