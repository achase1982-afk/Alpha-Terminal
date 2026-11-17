import { describe, expect, it } from "vitest";
import { analyzeExpirationPayoff } from "../expirationPayoff.js";
import { computeOptionPopFromPayoff, lognormalProbBetween, normalCdf } from "../optionPop.js";

const SPOT = 7540;
const IV = 0.18;
const T_3D = 3 / 252;
const EXP = "2026-11-20";

describe("optionPop", () => {
  it("normalCdf matches reference at 0", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 5);
  });

  it("hand-check lognormal between breakevens", () => {
    const low = 7527.95;
    const high = 7552.05;
    const denom = IV * Math.sqrt(T_3D);
    const drift = 0.5 * IV * IV * T_3D;
    const dLow = (Math.log(low / SPOT) + drift) / denom;
    const dHigh = (Math.log(high / SPOT) + drift) / denom;
    const handPct = (normalCdf(dHigh) - normalCdf(dLow)) * 100;
    const lib = lognormalProbBetween(SPOT, low, high, IV, T_3D);
    expect(lib).toBeCloseTo(handPct, 6);
  });

  it("debit call vertical 7540/7550 @ 4.00 ~ 48.4% (3d)", () => {
    const payoff = {
      legs: [
        { strike: 7540, optionType: "CALL", instruction: "BUY_TO_OPEN", quantity: 1, expiration: EXP },
        { strike: 7550, optionType: "CALL", instruction: "SELL_TO_OPEN", quantity: 1, expiration: EXP },
      ],
      netPerShare: 4,
      spreadUnits: 1,
      isCredit: false,
      isOption: true as const,
    };
    const bes = analyzeExpirationPayoff(payoff).breakevens;
    const pop = computeOptionPopFromPayoff({
      spot: SPOT,
      iv: IV,
      tYears: T_3D,
      breakevens: bes,
      payoff,
    });
    expect(pop).not.toBeNull();
    expect(pop!).toBeCloseTo(48.4, 0);
  });

  it("debit put vertical 7540/7530 @ 4.00 ~ 49.0% (3d)", () => {
    const payoff = {
      legs: [
        { strike: 7540, optionType: "PUT", instruction: "BUY_TO_OPEN", quantity: 1, expiration: EXP },
        { strike: 7530, optionType: "PUT", instruction: "SELL_TO_OPEN", quantity: 1, expiration: EXP },
      ],
      netPerShare: 4,
      spreadUnits: 1,
      isCredit: false,
      isOption: true as const,
    };
    const bes = analyzeExpirationPayoff(payoff).breakevens;
    const pop = computeOptionPopFromPayoff({
      spot: SPOT,
      iv: IV,
      tYears: T_3D,
      breakevens: bes,
      payoff,
    });
    expect(pop).not.toBeNull();
    expect(pop!).toBeCloseTo(49.0, 0);
  });

  it("credit put vertical: POP between breakevens", () => {
    const payoff = {
      legs: [
        { strike: 7530, optionType: "PUT", instruction: "SELL_TO_OPEN", quantity: 1, expiration: EXP },
        { strike: 7520, optionType: "PUT", instruction: "BUY_TO_OPEN", quantity: 1, expiration: EXP },
      ],
      netPerShare: 1.95,
      spreadUnits: 1,
      isCredit: true,
      isOption: true as const,
    };
    const bes = analyzeExpirationPayoff(payoff).breakevens;
    const pop = computeOptionPopFromPayoff({
      spot: SPOT,
      iv: IV,
      tYears: T_3D,
      breakevens: bes,
      payoff,
    });
    expect(pop).not.toBeNull();
    expect(pop!).toBeGreaterThan(10);
    expect(pop!).toBeLessThan(90);
  });

  it("iron condor credit: moderate POP inside wings", () => {
    const payoff = {
      legs: [
        { strike: 7525, optionType: "PUT", instruction: "BUY_TO_OPEN", quantity: 1, expiration: EXP },
        { strike: 7530, optionType: "PUT", instruction: "SELL_TO_OPEN", quantity: 1, expiration: EXP },
        { strike: 7550, optionType: "CALL", instruction: "SELL_TO_OPEN", quantity: 1, expiration: EXP },
        { strike: 7555, optionType: "CALL", instruction: "BUY_TO_OPEN", quantity: 1, expiration: EXP },
      ],
      netPerShare: 2.05,
      spreadUnits: 1,
      isCredit: true,
      isOption: true as const,
    };
    const bes = analyzeExpirationPayoff(payoff).breakevens;
    expect(bes).toHaveLength(2);
    const pop = computeOptionPopFromPayoff({
      spot: SPOT,
      iv: IV,
      tYears: T_3D,
      breakevens: bes,
      payoff,
    });
    expect(pop).not.toBeNull();
    expect(pop!).toBeGreaterThan(5);
    expect(pop!).toBeLessThan(60);
  });
});