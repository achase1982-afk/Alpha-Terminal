import { describe, expect, it } from "vitest";
import { chainGammaFlip, computeZoneModel, type ChainRowForZones } from "../zonesModel";

const SPOT = 7321;

/** Put-heavy below `flipAt`, call-heavy from it up: net gamma turns positive at `flipAt`. */
function chain(flipAt: number): ChainRowForZones[] {
  const rows: ChainRowForZones[] = [];
  for (let strike = 7225; strike <= 7420; strike += 5) {
    const gamma = 0.004 * Math.exp(-Math.abs(strike - SPOT) / 40);
    rows.push({
      strike,
      callOi: strike >= flipAt ? 2_000 : 300,
      putOi: strike >= flipAt ? 400 : 2_500,
      callGamma: gamma,
      putGamma: gamma,
    });
  }
  return rows;
}

describe("chain-derived gamma flip", () => {
  it("finds the cumulative zero cross, after per-strike gamma has already changed sign", () => {
    expect(chainGammaFlip(chain(7295), SPOT)).toBe(7325);
    expect(chainGammaFlip(chain(7310), SPOT)).toBe(7355);
  });

  it("is part of the chain zone model, with walls read from their own side", () => {
    const zones = computeZoneModel(chain(7295), SPOT);
    expect(zones.flip).toBe(7325);
    expect(zones.callWall).toBe(7320);
    expect(zones.putWall).toBe(7290);
    expect(zones.env).toBe("near_flip");
  });

  it("marks the environment near the flip when the cumulative cross sits on spot", () => {
    expect(computeZoneModel(chain(7295), SPOT).env).toBe("near_flip");
  });

  it("is null when cumulative gamma never crosses, or without open interest, gamma, or spot", () => {
    expect(chainGammaFlip(chain(7320), SPOT)).toBeNull();
    const allCalls = chain(7295).map((r) => ({ ...r, callOi: 2_000, putOi: 100 }));
    expect(chainGammaFlip(allCalls, SPOT)).toBeNull();
    expect(chainGammaFlip(chain(7295).map((r) => ({ ...r, callOi: 0, putOi: 0 })), SPOT)).toBeNull();
    expect(chainGammaFlip(chain(7295).map((r) => ({ ...r, callGamma: null, putGamma: null })), SPOT)).toBeNull();
    expect(chainGammaFlip(chain(7295), null)).toBeNull();
    expect(computeZoneModel([], SPOT).flip).toBeNull();
  });
});
