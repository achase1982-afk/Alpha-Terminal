import { describe, expect, it } from "vitest";
import { applyGlanceWallPolicy } from "../atGlanceWallPolicy.js";

const base = {
  callWall: 7340,
  putWall: 7320,
  flip: 7355,
  netGexUsdPer1Pct: -1e10,
  env: "amplifying" as const,
  asOfLabel: "4:15 PM",
};

describe("applyGlanceWallPolicy", () => {
  it("stale expiry nulls walls/flip and sets rolls at open", () => {
    const out = applyGlanceWallPolicy(base, {
      expiryYmd: "2026-11-17",
      sessionDateYmd: "2026-11-18",
      spot: 7340,
    });
    expect(out.staleExpiry).toBe(true);
    expect(out.callWall).toBeNull();
    expect(out.putWall).toBeNull();
    expect(out.flip).toBeNull();
    expect(out.wallsRollLabel).toBe("rolls at open");
    expect(out.netGexUsdPer1Pct).toBe(base.netGexUsdPer1Pct);
    expect(out.asOfLabel).toBe("4:15 PM");
  });

  it("current session expiry keeps walls", () => {
    const out = applyGlanceWallPolicy(base, {
      expiryYmd: "2026-11-18",
      sessionDateYmd: "2026-11-18",
      spot: 7340,
    });
    expect(out.staleExpiry).toBe(false);
    expect(out.callWall).toBe(7340);
    expect(out.flip).toBe(7355);
  });

  it("coincident ATM walls become pin", () => {
    const pinned = { ...base, callWall: 7340, putWall: 7340 };
    const out = applyGlanceWallPolicy(pinned, {
      expiryYmd: "2026-11-17",
      sessionDateYmd: "2026-11-17",
      spot: 7340.5,
    });
    expect(out.gammaPinStrike).toBe(7340);
    expect(out.callWall).toBeNull();
    expect(out.putWall).toBeNull();
  });
});