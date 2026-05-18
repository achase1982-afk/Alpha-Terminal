import { describe, expect, it } from "vitest";
import { computeBollingerBands20_2 } from "../bollingerBandsDaily.js";

describe("computeBollingerBands20_2", () => {
  it("returns null when fewer than 20 closes", () => {
    expect(computeBollingerBands20_2(Array.from({ length: 19 }, () => 100))).toBeNull();
  });

  it("computes flat band when all closes equal", () => {
    const closes = Array.from({ length: 20 }, () => 50);
    const bb = computeBollingerBands20_2(closes);
    expect(bb).not.toBeNull();
    expect(bb!.middle).toBe(50);
    expect(bb!.upper).toBe(50);
    expect(bb!.lower).toBe(50);
    expect(bb!.lastClose).toBe(50);
    expect(bb!.pctB).toBeNull();
  });

  it("puts last close above upper when last bar spikes", () => {
    const base = Array.from({ length: 19 }, () => 100);
    const closes = [...base, 130];
    const bb = computeBollingerBands20_2(closes);
    expect(bb).not.toBeNull();
    expect(bb!.lastClose).toBe(130);
    expect(bb!.lastClose).toBeGreaterThan(bb!.upper);
    expect(bb!.pctB).not.toBeNull();
    expect(bb!.pctB!).toBeGreaterThan(1);
  });
});
