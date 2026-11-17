import { describe, expect, it } from "vitest";
import { buildChainHoldSignature } from "../streamHoldSig";

describe("buildChainHoldSignature", () => {
  const keys = ["SPY   251121C00600000", "SPY   251121P00600000"];
  const expirations = ["2025-11-21"];

  it("holdSig unchanged across 30 synthetic spot-only tick payloads", () => {
    const base = buildChainHoldSignature("SPY", expirations, keys);
    for (let i = 0; i < 30; i++) {
      const next = buildChainHoldSignature("SPY", expirations, keys);
      expect(next.holdSig).toBe(base.holdSig);
    }
  });
});