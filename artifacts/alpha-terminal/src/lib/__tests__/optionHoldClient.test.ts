import { describe, expect, it } from "vitest";
import { payloadsEqual, shouldTrackOptionHold } from "../optionHoldClient";

describe("optionHoldClient", () => {
  it("does not track hold after abort", () => {
    expect(shouldTrackOptionHold(true, () => true)).toBe(false);
    expect(shouldTrackOptionHold(true, () => false)).toBe(true);
    expect(shouldTrackOptionHold(false, () => false)).toBe(false);
  });

  it("payloadsEqual ignores symbol order", () => {
    expect(payloadsEqual(["B", "A"], ["A", "B"])).toBe(true);
  });
});