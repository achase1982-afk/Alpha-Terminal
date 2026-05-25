import { describe, expect, it } from "vitest";
import { classifyCatalystDrift } from "@workspace/catalysts-types";
import { buildPatternRead, computeSessionSnapshot } from "../catalystMetrics.js";

describe("catalystMetrics", () => {
  it("computes cumulative windows and streak from settled closes", () => {
    const sessionDates = ["2026-05-12", "2026-05-13", "2026-05-14", "2026-05-15", "2026-05-16"];
    const closesByDate = new Map<string, number>([
      ["2026-05-11", 100],
      ["2026-05-12", 102],
      ["2026-05-13", 104],
      ["2026-05-14", 106],
      ["2026-05-15", 108],
      ["2026-05-16", 110],
    ]);
    const snap = computeSessionSnapshot(sessionDates, closesByDate);
    expect(snap).not.toBeNull();
    expect(snap!.sessionMovesPct.every((m) => m > 0)).toBe(true);
    expect(snap!.streak).toBe(5);
    expect(snap!.cumulative5d).toBeGreaterThan(0);
    expect(snap!.patternRead).toContain("Strong directional drift");
  });

  it("returns choppy pattern when moves mixed", () => {
    const moves = [1, -1, 1, -1, 0.5];
    expect(buildPatternRead(moves, 1)).toContain("Choppy");
  });

  it("classifyCatalystDrift matches pattern-read thresholds", () => {
    expect(classifyCatalystDrift([1, 2, 1, 2, 1], null)).toBe("trending_up");
    expect(classifyCatalystDrift([-1, -2, -1, -2, -1], null)).toBe("trending_down");
    expect(classifyCatalystDrift([1, -1, 1, -1, 0], null)).toBe("choppy");
  });
});
