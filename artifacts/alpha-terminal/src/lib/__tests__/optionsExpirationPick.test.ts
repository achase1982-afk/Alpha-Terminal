import { describe, expect, it } from "vitest";
import { filterAtExpiryPillGroups, nearestTradableExpiration } from "../optionsExpirationPick";

describe("optionsExpirationPick", () => {
  const groups = [
    { expiration: "2026-11-17", dte: -1 },
    { expiration: "2026-11-18", dte: 0 },
    { expiration: "2026-11-25", dte: 7 },
  ];

  it("keeps today's 0DTE before the session closes", () => {
    const beforeClose = Date.parse("2026-11-18T21:14:00.000Z");
    expect(nearestTradableExpiration(groups, beforeClose)?.expiration).toBe("2026-11-18");
  });

  it("rolls 0DTE to the next expiry at 4:15 PM ET", () => {
    const afterClose = Date.parse("2026-11-18T21:15:00.000Z");
    expect(nearestTradableExpiration(groups, afterClose)?.expiration).toBe("2026-11-25");
    expect(filterAtExpiryPillGroups(groups, afterClose).map((g) => g.expiration)).toEqual([
      "2026-11-25",
    ]);
  });

  it("returns null when only expired expiries remain", () => {
    expect(nearestTradableExpiration([{ expiration: "2026-11-17", dte: -1 }])).toBeNull();
  });

  it("filters expired expiries from AT pill list", () => {
    const beforeClose = Date.parse("2026-11-18T21:14:00.000Z");
    expect(filterAtExpiryPillGroups(groups, beforeClose).map((g) => g.expiration)).toEqual([
      "2026-11-18",
      "2026-11-25",
    ]);
  });
});