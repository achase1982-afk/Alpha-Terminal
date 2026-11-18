import { describe, expect, it } from "vitest";
import { formatAtGlanceSpot } from "../atGlanceSpotFormat";

describe("formatAtGlanceSpot", () => {
  it("keeps two decimals for NVDA", () => {
    expect(formatAtGlanceSpot("NVDA", 182.42)).toBe("182.42");
  });
  it("keeps quarter ticks for /ES", () => {
    expect(formatAtGlanceSpot("/ES", 5950.25)).toBe("5,950.25");
  });
  it("formats SPX with two decimals", () => {
    expect(formatAtGlanceSpot("$SPX", 7545.12)).toBe("7,545.12");
  });
});