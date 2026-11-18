import { describe, expect, it } from "vitest";
import {
  computeHighZoneBottom,
  computeLowZoneTop,
  formatSessionFeedLevel,
  roundToHalfPoint,
  SPX_REF_ZONE_K_DEFAULT,
} from "../spxRefZone";

describe("spxRefZone", () => {
  it("rounds zone refs to 0.5 without strike snap", () => {
    expect(roundToHalfPoint(7323.2)).toBe(7323);
    expect(roundToHalfPoint(7323.4)).toBe(7323.5);
    expect(computeLowZoneTop(7288, SPX_REF_ZONE_K_DEFAULT)).toBe(7323);
  });

  it("mirrors high zone bottom from session high", () => {
    expect(computeHighZoneBottom(7400.37, SPX_REF_ZONE_K_DEFAULT)).toBe(7365.5);
  });

  it("keeps feed precision on session levels", () => {
    expect(formatSessionFeedLevel(7400.37)).toBe("7,400.37");
    expect(formatSessionFeedLevel(7288)).toBe("7,288");
  });
});