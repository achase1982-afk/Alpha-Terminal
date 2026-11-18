import { describe, expect, it } from "vitest";
import {
  computeLowZoneTop,
  computeRthSessionLowFromMinuteCandles,
  roundToHalfPoint,
  SPX_LOW_ZONE_K_DEFAULT,
} from "../spxLowZone";

describe("spxLowZone", () => {
  it("rounds to 0.5 without strike snap", () => {
    expect(roundToHalfPoint(7323.2)).toBe(7323);
    expect(roundToHalfPoint(7323.4)).toBe(7323.5);
    expect(computeLowZoneTop(7288, SPX_LOW_ZONE_K_DEFAULT)).toBe(7323);
  });

  it("ignores overnight and non-RTH minute bars", () => {
    const candles = [
      { datetime: "2026-11-18T04:15:00.000Z", low: 7100 },
      { datetime: "2026-11-18T14:35:00.000Z", low: 7288 },
      { datetime: "2026-11-18T15:00:00.000Z", low: 7295 },
    ];
    const now = new Date("2026-11-18T15:30:00.000Z");
    expect(computeRthSessionLowFromMinuteCandles(candles, now)).toBe(7288);
  });

  it("returns null when no RTH bars", () => {
    const now = new Date("2026-11-18T13:00:00.000Z");
    expect(computeRthSessionLowFromMinuteCandles([], now)).toBeNull();
  });
});