import { describe, expect, it } from "vitest";
import { formatDayRangeLabel } from "../formatDayRange";

describe("formatDayRangeLabel", () => {
  it("renders em dash for null or zero placeholder", () => {
    expect(formatDayRangeLabel(0, 0, 0)).toBe("\u2014");
    expect(formatDayRangeLabel(null, null)).toBe("\u2014");
    expect(formatDayRangeLabel(350.61, 350.61, 1.2)).toBe("\u2014");
  });

  it("renders valid range", () => {
    expect(formatDayRangeLabel(352, 348, 1.2)).toBe("$348.00\u2014$352.00");
  });
});