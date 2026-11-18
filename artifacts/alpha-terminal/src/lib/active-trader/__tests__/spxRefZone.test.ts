import { describe, expect, it } from "vitest";
import {
  SPX_REF_ZONE_K_DEFAULT,
  computeHighZoneBottom,
  computeLowZoneTop,
  formatRefZoneHalf,
} from "../spxRefZone";

describe("spxRefZone", () => {
  it("uses percent k default 0.004", () => {
    expect(SPX_REF_ZONE_K_DEFAULT).toBe(0.004);
  });

  it("low top and high bottom from session levels", () => {
    expect(computeLowZoneTop(7288)).toBe(7317);
    expect(computeHighZoneBottom(7368)).toBe(7338.5);
    expect(formatRefZoneHalf(7317)).toBe("7,317");
  });

  it("half-point snap on fractional session feeds", () => {
    expect(computeLowZoneTop(7288.12)).toBe(7317.5);
  });

  it("~0.4% distance at 7340 spot", () => {
    const top = computeLowZoneTop(7340)!;
    expect(top).toBe(7369.5);
    expect(top - 7340).toBeCloseTo(29.36, 0);
  });
});