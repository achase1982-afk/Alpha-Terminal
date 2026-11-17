import { describe, expect, it } from "vitest";
import { schwab2ExpectedCallbackPath, verifySchwab2State, signSchwab2State } from "../deskSchwab2OAuth.js";

describe("deskSchwab2OAuth", () => {
  it("exposes fixed callback path", () => {
    expect(schwab2ExpectedCallbackPath()).toBe("/api/auth/trader-callback");
  });

  it("signs and verifies state", () => {
    const state = signSchwab2State();
    expect(verifySchwab2State(state)).toBe(true);
    expect(verifySchwab2State("invalid")).toBe(false);
  });
});