import { describe, expect, it } from "vitest";
import { isAtmStrike, resolveAtmStrike } from "../atmStrike.js";

describe("resolveAtmStrike", () => {
  const strikes = [7315, 7320, 7325, 7330, 7335, 7340, 7345, 7350, 7355, 7360];

  it("picks 7340 for spot 7337.95 with lower-strike tie break", () => {
    const atm = resolveAtmStrike(strikes, 7337.95);
    expect(atm).toBe(7340);
    expect(isAtmStrike(7340, atm)).toBe(true);
    expect(isAtmStrike(7320, atm)).toBe(false);
  });
});
