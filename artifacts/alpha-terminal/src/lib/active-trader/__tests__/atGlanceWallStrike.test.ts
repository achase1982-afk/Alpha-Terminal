import { describe, expect, it } from "vitest";
import { sanitizeGlanceWallStrike } from "../atGlanceWallStrike";

describe("sanitizeGlanceWallStrike", () => {
  it("drops chain wall on spot with no OI", () => {
    expect(sanitizeGlanceWallStrike(7340, 7340.53, "chain", [])).toBeNull();
  });

  it("keeps uw wall even at spot", () => {
    expect(sanitizeGlanceWallStrike(7340, 7340.53, "uw", [])).toBe(7340);
  });
});