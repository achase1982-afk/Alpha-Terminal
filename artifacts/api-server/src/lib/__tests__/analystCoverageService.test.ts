import { describe, expect, it } from "vitest";
import { mapRatingToBucket } from "../polygonAnalystData.js";

describe("mapRatingToBucket", () => {
  it("maps strong buy phrases", () => {
    expect(mapRatingToBucket("Strong Buy")).toBe("strong_buy");
  });
  it("maps hold phrases", () => {
    expect(mapRatingToBucket("Market Perform")).toBe("hold");
  });
});
