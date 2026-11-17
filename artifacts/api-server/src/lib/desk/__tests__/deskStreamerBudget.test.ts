import { describe, expect, it, beforeEach } from "vitest";
import {
  deskAppLevelOneOptionsCap,
  deskComputeDeskLevelOneOptionsBudget,
  deskParseSchwabStreamerLimitMessage,
  deskResetStreamerLimitsForTests,
} from "../deskStreamerBudget.js";

describe("deskStreamerBudget", () => {
  beforeEach(() => deskResetStreamerLimitsForTests());

  it("computes fixed desk budget independent of app holds", () => {
    expect(deskComputeDeskLevelOneOptionsBudget()).toBe(2822);
    expect(deskAppLevelOneOptionsCap()).toBe(178);
  });

  it("parses LEVELONE_OPTIONS cap from rejection message", () => {
    deskParseSchwabStreamerLimitMessage(
      "maximum number of symbols allowed (LEVELONE_OPTIONS=3000, DISCARDED=500)",
    );
    expect(deskComputeDeskLevelOneOptionsBudget()).toBe(2822);
    expect(deskAppLevelOneOptionsCap()).toBe(178);
  });
});
