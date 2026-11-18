import { describe, expect, it } from "vitest";
import { computeHighZoneBottom, computeLowZoneTop, formatRefZoneHalf } from "../spxRefZone";

describe("spxRefZone", () => {
  it("low top and high bottom", () => {
    expect(computeLowZoneTop(7288)).toBe(7323);
    expect(computeHighZoneBottom(7368)).toBe(7333);
    expect(formatRefZoneHalf(7323)).toBe("7,323");
  });
});