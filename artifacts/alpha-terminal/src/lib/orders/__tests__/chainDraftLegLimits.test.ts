import { describe, expect, it } from "vitest";
import {
  assertChainDraftLegCount,
  canAddChainDraftLeg,
  CHAIN_MAX_DRAFT_LEGS,
  CHAIN_LEG_LIMIT_MESSAGE,
} from "../chainDraftLegLimits";

describe("chainDraftLegLimits", () => {
  it("allows up to four legs", () => {
    expect(canAddChainDraftLeg(0)).toBe(true);
    expect(canAddChainDraftLeg(3)).toBe(true);
    expect(canAddChainDraftLeg(4)).toBe(false);
    assertChainDraftLegCount(4);
  });

  it("rejects more than four", () => {
    expect(canAddChainDraftLeg(5)).toBe(false);
    expect(() => assertChainDraftLegCount(5)).toThrow(String(CHAIN_MAX_DRAFT_LEGS));
  });

  it("exposes user-facing limit copy", () => {
    expect(CHAIN_LEG_LIMIT_MESSAGE).toMatch(/4-leg maximum/i);
  });
});