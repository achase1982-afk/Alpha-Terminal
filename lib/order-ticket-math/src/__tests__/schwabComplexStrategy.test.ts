import { describe, expect, it } from "vitest";
import {
  coerceSchwabComplexOrderStrategyType,
  inferSchwabComplexOrderStrategyType,
} from "../schwabComplexStrategy.js";

const EXP = "2026-11-20";

describe("inferSchwabComplexOrderStrategyType", () => {
  it("labels true iron condor", () => {
    const legs = [
      { strike: 7525, optionType: "PUT", instruction: "BUY_TO_OPEN", quantity: 1, expiration: EXP },
      { strike: 7530, optionType: "PUT", instruction: "SELL_TO_OPEN", quantity: 1, expiration: EXP },
      { strike: 7550, optionType: "CALL", instruction: "SELL_TO_OPEN", quantity: 1, expiration: EXP },
      { strike: 7555, optionType: "CALL", instruction: "BUY_TO_OPEN", quantity: 1, expiration: EXP },
    ];
    expect(inferSchwabComplexOrderStrategyType(legs)).toBe("IRON_CONDOR");
  });

  it("4-leg 2C/2P with unequal wings is CUSTOM", () => {
    const legs = [
      { strike: 7520, optionType: "PUT", instruction: "BUY_TO_OPEN", quantity: 1, expiration: EXP },
      { strike: 7530, optionType: "PUT", instruction: "SELL_TO_OPEN", quantity: 1, expiration: EXP },
      { strike: 7550, optionType: "CALL", instruction: "SELL_TO_OPEN", quantity: 1, expiration: EXP },
      { strike: 7555, optionType: "CALL", instruction: "BUY_TO_OPEN", quantity: 1, expiration: EXP },
    ];
    expect(inferSchwabComplexOrderStrategyType(legs)).toBe("CUSTOM");
  });

  it("iron butterfly is CUSTOM — Schwab rejects the IRON_BUTTERFLY label", () => {
    const legs = [
      { strike: 6995, optionType: "PUT", instruction: "BUY_TO_OPEN", quantity: 1, expiration: EXP },
      { strike: 7000, optionType: "PUT", instruction: "SELL_TO_OPEN", quantity: 1, expiration: EXP },
      { strike: 7000, optionType: "CALL", instruction: "SELL_TO_OPEN", quantity: 1, expiration: EXP },
      { strike: 7005, optionType: "CALL", instruction: "BUY_TO_OPEN", quantity: 1, expiration: EXP },
    ];
    expect(inferSchwabComplexOrderStrategyType(legs)).toBe("CUSTOM");
    expect(coerceSchwabComplexOrderStrategyType("IRON_BUTTERFLY")).toBe("CUSTOM");
    expect(coerceSchwabComplexOrderStrategyType("IRON_CONDOR")).toBe("IRON_CONDOR");
  });

  it("vertical on same expiry", () => {
    const legs = [
      { strike: 7540, optionType: "CALL", instruction: "BUY_TO_OPEN", quantity: 1, expiration: EXP },
      { strike: 7550, optionType: "CALL", instruction: "SELL_TO_OPEN", quantity: 1, expiration: EXP },
    ];
    expect(inferSchwabComplexOrderStrategyType(legs)).toBe("VERTICAL");
  });
});