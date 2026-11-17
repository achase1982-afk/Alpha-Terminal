import { describe, expect, it, beforeEach } from "vitest";
import {
  APP_L1_OPTIONS_MAX,
  deskAppLevelOneOptionsCap,
  deskComputeDeskLevelOneOptionsBudget,
  deskParseSchwabStreamerLimitMessage,
  deskResetStreamerLimitsForTests,
} from "../deskStreamerBudget.js";

describe("deskStreamerBudget", () => {
  beforeEach(() => deskResetStreamerLimitsForTests());

  it("derives desk budget from app plan size", () => {
    expect(deskComputeDeskLevelOneOptionsBudget(0)).toBe(2822);
    expect(deskComputeDeskLevelOneOptionsBudget(178)).toBe(2672);
    expect(deskAppLevelOneOptionsCap()).toBe(APP_L1_OPTIONS_MAX);
  });

  it("parses LEVELONE_OPTIONS cap from rejection message", () => {
    deskParseSchwabStreamerLimitMessage(
      "maximum number of symbols allowed (LEVELONE_OPTIONS=3000, DISCARDED=500)",
    );
    expect(deskComputeDeskLevelOneOptionsBudget(0)).toBe(2822);
    expect(deskComputeDeskLevelOneOptionsBudget(600)).toBe(2250);
  });
});
