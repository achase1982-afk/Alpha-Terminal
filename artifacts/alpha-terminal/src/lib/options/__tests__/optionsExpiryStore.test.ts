import { describe, expect, it, beforeEach } from "vitest";
import { useOptionsExpiryStore } from "../optionsExpiryStore";

describe("optionsExpiryStore", () => {
  beforeEach(() => {
    useOptionsExpiryStore.setState({ bySymbol: {} });
  });

  it("stores explicit selection per symbol", () => {
    useOptionsExpiryStore.getState().setExplicit("$SPX", "2026-11-20");
    expect(useOptionsExpiryStore.getState().getSelected("SPX")).toBe("2026-11-20");
    expect(useOptionsExpiryStore.getState().getExplicit("SPX")).toBe("2026-11-20");
  });
});