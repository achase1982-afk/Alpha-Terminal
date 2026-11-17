import { describe, expect, it, beforeEach } from "vitest";
import {
  deskComputeDeskLevelOneOptionsBudget,
  deskParseSchwabStreamerLimitMessage,
  deskResetStreamerLimitsForTests,
} from "../deskStreamerBudget.js";

describe("deskStreamerBudget", () => {
  beforeEach(() => deskResetStreamerLimitsForTests());

  it("computes desk budget with headroom", () => {
    expect(deskComputeDeskLevelOneOptionsBudget(100)).toBe(3000 - 100 - 150);
  });

  it("parses LEVELONE_OPTIONS cap from rejection message", () => {
    deskParseSchwabStreamerLimitMessage(
      "maximum number of symbols allowed (LEVELONE_OPTIONS=3000, DISCARDED=500)",
    );
    expect(deskComputeDeskLevelOneOptionsBudget(0)).toBe(3000 - 150);
  });
});