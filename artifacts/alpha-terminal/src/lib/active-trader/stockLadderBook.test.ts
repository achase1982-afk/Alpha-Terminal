import { describe, expect, it } from "vitest";
import { stockLadderSpotKey } from "./stockLadderBook";

describe("stockLadderSpotKey", () => {
  it("snaps mid-market anchor to the ladder tick", () => {
    expect(stockLadderSpotKey(182.425)).toBe("182.43");
    expect(stockLadderSpotKey((100.01 + 100.03) / 2)).toBe("100.02");
  });

  it("returns null without a positive anchor", () => {
    expect(stockLadderSpotKey(null)).toBeNull();
    expect(stockLadderSpotKey(0)).toBeNull();
  });
});