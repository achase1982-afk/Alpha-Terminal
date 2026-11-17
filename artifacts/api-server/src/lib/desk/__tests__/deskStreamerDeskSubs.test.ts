import { describe, expect, it } from "vitest";
import { deskStreamerDeskSymbolPlan } from "../deskStreamerDeskSubs.js";

describe("deskStreamerDeskSymbolPlan", () => {
  it("unsubs symbols rolled off the allowed set", () => {
    const current = new Set(["A", "B", "C"]);
    const plan = deskStreamerDeskSymbolPlan(current, ["B", "D"], 10);
    expect(plan.remove.sort()).toEqual(["A", "C"]);
    expect(plan.add).toEqual(["D"]);
    expect(plan.next).toEqual(["B", "D"]);
  });

  it("shrinks desk set when budget drops after app claims book symbols", () => {
    const current = new Set(["S1", "S2", "S3", "S4", "S5"]);
    const plan = deskStreamerDeskSymbolPlan(current, ["S1", "S2", "S3", "S4", "S5"], 2);
    expect(plan.next).toEqual(["S1", "S2"]);
    expect(plan.remove.sort()).toEqual(["S3", "S4", "S5"]);
    expect(plan.add).toEqual([]);
  });
});
