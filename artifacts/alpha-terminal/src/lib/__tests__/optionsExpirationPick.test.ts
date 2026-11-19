import { describe, expect, it } from "vitest";
import {
  filterAtExpiryPillGroups,
  mergeExpiryCatalog,
  nearestTradableExpiration,
  resolveSelectedExpiration,
} from "../optionsExpirationPick";

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

describe("expiry catalog", () => {
  const catalog = [
    { expiration: "2026-11-19", dte: 0 },
    { expiration: "2026-11-20", dte: 1 },
    { expiration: "2026-11-21", dte: 2 },
  ];

  it("keeps the chain date list when a single-expiry ladder page arrives", () => {
    const next = mergeExpiryCatalog(catalog, [{ expiration: "2026-11-19", dte: 0 }], "at");
    expect(next.map((row) => row.expiration)).toEqual(["2026-11-19", "2026-11-20", "2026-11-21"]);
  });

  it("keeps the chain date list when the chain response is still the narrow placeholder", () => {
    const next = mergeExpiryCatalog(catalog, [{ expiration: "2026-11-19", dte: 0 }], "chain");
    expect(next).toBe(catalog);
  });

  it("replaces the catalog when the chain returns another full book", () => {
    const full = [
      { expiration: "2026-11-20", dte: 1 },
      { expiration: "2026-11-21", dte: 2 },
      { expiration: "2026-11-24", dte: 5 },
    ];
    expect(mergeExpiryCatalog(catalog, full, "chain").map((row) => row.expiration)).toEqual([
      "2026-11-20",
      "2026-11-21",
      "2026-11-24",
    ]);
  });

  it("keeps the expanded expiry when the ladder page is a different date", () => {
    const now = Date.parse("2026-11-19T15:00:00.000Z");
    expect(
      resolveSelectedExpiration({
        previous: "2026-11-20",
        catalog: [{ expiration: "2026-11-19", dte: 0 }],
        expanded: ["2026-11-20"],
        nowMs: now,
      }),
    ).toBe("2026-11-20");
  });

  it("uses the last chain row the user opened when nothing is selected yet", () => {
    const now = Date.parse("2026-11-19T15:00:00.000Z");
    expect(
      resolveSelectedExpiration({
        previous: null,
        catalog,
        expanded: ["2026-11-19", "2026-11-20"],
        nowMs: now,
      }),
    ).toBe("2026-11-20");
  });

  it("picks the nearest tradable expiry when the user has not chosen one", () => {
    const now = Date.parse("2026-11-19T15:00:00.000Z");
    expect(
      resolveSelectedExpiration({
        previous: null,
        catalog,
        expanded: [],
        nowMs: now,
      }),
    ).toBe("2026-11-19");
  });
});