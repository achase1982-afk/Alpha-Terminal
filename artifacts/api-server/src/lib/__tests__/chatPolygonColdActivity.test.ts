import { describe, expect, it } from "vitest";
import {
  userRequestsOptionsTapeDetail,
  snapshotSuggestsElevatedActivity,
  schwabStyleToPolygonOcc,
} from "../chatPolygonColdActivity.js";
import type { PolygonChainResult } from "../polygonChain.js";

describe("chatPolygonColdActivity", () => {
  it("schwabStyleToPolygonOcc maps padded root", () => {
    expect(schwabStyleToPolygonOcc("GM    260116C00080000")).toBe("O:GM260116C00080000");
    expect(schwabStyleToPolygonOcc("bad")).toBeNull();
  });

  it("userRequestsOptionsTapeDetail detects flow phrasing", () => {
    expect(userRequestsOptionsTapeDetail("Any unusual option activity today?")).toBe(true);
    expect(userRequestsOptionsTapeDetail("What's going on with GM?")).toBe(true);
    expect(userRequestsOptionsTapeDetail("What is a put option?")).toBe(false);
  });

  it("snapshotSuggestsElevatedActivity flags concentrated volume", () => {
    const flat: PolygonChainResult = {
      calls: [{ strike: 50, expiration: "2026-06-19", volume: 10, openInterest: 1000 }],
      puts: [{ strike: 50, expiration: "2026-06-19", volume: 5, openInterest: 1000 }],
      underlyingPrice: 50,
    };
    expect(snapshotSuggestsElevatedActivity(flat)).toBe(false);

    const hot: PolygonChainResult = {
      calls: [
        { strike: 80, expiration: "2026-06-19", volume: 5000, openInterest: 200 },
        { strike: 81, expiration: "2026-06-19", volume: 100, openInterest: 500 },
      ],
      puts: [{ strike: 79, expiration: "2026-06-19", volume: 4000, openInterest: 300 }],
      underlyingPrice: 80,
    };
    expect(snapshotSuggestsElevatedActivity(hot)).toBe(true);
  });
});
