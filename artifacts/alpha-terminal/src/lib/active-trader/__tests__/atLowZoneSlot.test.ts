import { describe, expect, it } from "vitest";
import { computeLowZoneTopRef, resolveLowZoneSlotDisplay } from "../atLowZoneSlot";

describe("resolveLowZoneSlotDisplay", () => {
  it("builds top with half-point only", () => {
    const z = resolveLowZoneSlotDisplay(7288.12);
    expect(z.status).toBe("value");
    if (z.status === "value") {
      expect(z.top).toBe(7317.5);
    }
    expect(computeLowZoneTopRef(7288.12)).toBe(7317.5);
  });

  it("unavailable without session low", () => {
    expect(resolveLowZoneSlotDisplay(null).status).toBe("unavailable");
  });
});