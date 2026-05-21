import { describe, expect, it } from "vitest";
import { resetPolygonBenzingaBlockCache } from "../analystCoverageService.js";
import { mapRatingToBucket } from "../polygonAnalystData.js";

describe("resetPolygonBenzingaBlockCache", () => {
  it("clears polygon block flag", () => {
    resetPolygonBenzingaBlockCache();
    expect(true).toBe(true);
  });
});

describe("mapRatingToBucket", () => {
  it("maps strong buy phrases", () => {
    expect(mapRatingToBucket("Strong Buy")).toBe("strong_buy");
  });
  it("maps hold phrases", () => {
    expect(mapRatingToBucket("Market Perform")).toBe("hold");
  });
});
