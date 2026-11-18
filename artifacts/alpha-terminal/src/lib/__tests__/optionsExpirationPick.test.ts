import { describe, expect, it } from "vitest";
import { filterAtExpiryPillGroups, nearestTradableExpiration } from "../optionsExpirationPick";

describe("optionsExpirationPick", () => {
  const groups = [
    { expiration: "2026-11-17", dte: -1 },
    { expiration: "2026-11-18", dte: 0 },
    { expiration: "2026-11-25", dte: 7 },
  ];

  it("picks nearest dte >= 0 after session roll", () => {
    expect(nearestTradableExpiration(groups)?.expiration).toBe("2026-11-18");
  });

  it("returns null when only expired expiries remain", () => {
    expect(nearestTradableExpiration([{ expiration: "2026-11-17", dte: -1 }])).toBeNull();
  });

  it("filters expired expiries from AT pill list", () => {
    expect(filterAtExpiryPillGroups(groups).map((g) => g.expiration)).toEqual([
      "2026-11-18",
      "2026-11-25",
    ]);
  });
});