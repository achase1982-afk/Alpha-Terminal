import { describe, expect, it } from "vitest";
import {
  ladderStrikeZoneTag,
  resolveCallWallDisplay,
  resolveGammaFlipDisplay,
  resolveGlanceWallLayout,
  resolvePutWallDisplay,
} from "../atGlanceWallDisplay";
import type { ZoneModel } from "../zonesModel";

const base: ZoneModel = {
  callWall: 7365,
  putWall: 7320,
  flip: 7355,
  netGexUsdPer1Pct: -1e9,
  env: "amplifying",
  asOfLabel: "4:15 PM",
};

describe("atGlanceWallDisplay", () => {
  it("stale expiry shows rolls at open on walls and flip", () => {
    const zones: ZoneModel = { ...base, callWall: null, putWall: null, flip: null, wallsRollLabel: "rolls at open" };
    expect(resolveCallWallDisplay(zones).value).toBe("\u2014 rolls at open");
    expect(resolvePutWallDisplay(zones).value).toBe("\u2014 rolls at open");
    expect(resolveGammaFlipDisplay(zones)).toBe("\u2014 rolls at open");
    expect(ladderStrikeZoneTag(zones, 7340)).toBeNull();
  });

  it("pin shows on call column and hides put wall number", () => {
    const zones: ZoneModel = {
      ...base,
      callWall: null,
      putWall: null,
      gammaPinStrike: 7340,
    };
    expect(resolveCallWallDisplay(zones).label).toBe("Pin");
    expect(resolveCallWallDisplay(zones).value).toBe("7,340");
    expect(resolvePutWallDisplay(zones).value).toBe("\u2014");
    expect(ladderStrikeZoneTag(zones, 7340)).toBe("PIN");
  });

  it("rolled current session shows distinct walls", () => {
    expect(resolveCallWallDisplay(base).value).toBe("7,365");
    expect(resolvePutWallDisplay(base).value).toBe("7,320");
    expect(ladderStrikeZoneTag(base, 7365)).toBe("CALL WALL");
  });

  it("closed walls share one roll status and live walls stay split", () => {
    const closed: ZoneModel = { ...base, callWall: null, putWall: null, flip: null, wallsRollLabel: "rolls at open" };
    const shared = resolveGlanceWallLayout(closed);
    expect(shared.mode).toBe("shared");
    if (shared.mode !== "shared") return;
    expect(shared.label).toBe("Call · Put wall");
    expect(shared.value).toBe("\u2014 rolls at open");
    expect(shared.value.match(/rolls at open/g)).toHaveLength(1);

    const live = resolveGlanceWallLayout(base);
    expect(live.mode).toBe("split");
    if (live.mode !== "split") return;
    expect(live.call.value).toBe("7,365");
    expect(live.put.value).toBe("7,320");
  });
});