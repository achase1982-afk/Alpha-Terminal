import { describe, expect, it } from "vitest";
import {
  computeLowZoneTop,
  formatLowZoneRefDisplay,
  formatAsOfEtLabel,
  roundToHalfPoint,
  SPX_LOW_ZONE_K_DEFAULT,
} from "../spxLowZone";
import { formatDayLowLevel } from "../atDayLow";

describe("spxLowZone", () => {
  it("rounds Low zone (ref) to 0.5 without strike snap", () => {
    expect(roundToHalfPoint(7323.2)).toBe(7323);
    expect(roundToHalfPoint(7323.4)).toBe(7323.5);
    expect(computeLowZoneTop(7288, SPX_LOW_ZONE_K_DEFAULT)).toBe(7323);
  });

  it("keeps Day low at feed precision; only Low zone (ref) is half-point rounded", () => {
    const sessionLow = 7288.12;
    const zoneTop = computeLowZoneTop(sessionLow, SPX_LOW_ZONE_K_DEFAULT)!;
    expect(formatDayLowLevel(sessionLow)).toBe("7,288.12");
    expect(formatLowZoneRefDisplay(zoneTop)).toBe("7,323.0");
  });

  it("formats as-of in ET", () => {
    expect(formatAsOfEtLabel(new Date("2026-11-18T15:47:00.000Z"))).toBe("as of 10:47 ET");
  });
});
