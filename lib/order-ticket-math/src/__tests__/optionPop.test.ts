import { describe, expect, it } from "vitest";
import {
  computeOptionPop,
  lognormalProbBetween,
  normalCdf,
} from "../optionPop.js";

describe("optionPop", () => {
  it("normalCdf matches reference at 0", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 5);
  });

  it("hand-check lognormal between breakevens for SPX iron condor", () => {
    const spot = 7540;
    const low = 7527.95;
    const high = 7552.05;
    const iv = 0.18;
    const tYears = 1 / 252;
  const sigma = iv;
  const sqrtT = Math.sqrt(tYears);
  const denom = sigma * sqrtT;
    const dLow = (Math.log(low / spot) + 0.5 * sigma * sigma * tYears) / denom;
    const dHigh = (Math.log(high / spot) + 0.5 * sigma * sigma * tYears) / denom;
    const handPct = (normalCdf(dHigh) - normalCdf(dLow)) * 100;

    const lib = lognormalProbBetween(spot, low, high, iv, tYears);
    expect(lib).not.toBeNull();
    expect(lib!).toBeCloseTo(handPct, 6);
    expect(handPct).toBeGreaterThan(5);
    expect(handPct).toBeLessThan(25);

    const pop = computeOptionPop({
      spot,
      breakevens: [low, high],
      isCredit: true,
      iv,
      tYears,
    });
    expect(pop).toBeCloseTo(handPct, 6);
  });
});