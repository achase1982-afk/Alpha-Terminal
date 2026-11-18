import { describe, expect, it } from "vitest";
import { computeLowZoneTopRef, resolveLowZoneSlotDisplay } from "../atLowZoneSlot";

describe("resolveLowZoneSlotDisplay", () => {
  it("builds band with half-point top only", () => {
    const z = resolveLowZoneSlotDisplay(7288.12);
    expect(z.status).toBe("band");
    if (z.status === "band") {
      expect(z.dayLow).toBe(7288.12);
      expect(z.top).toBe(7323);
    }
    expect(computeLowZoneTopRef(7288.12)).toBe(7323);
  });

  it("pending without session low", () => {
    expect(resolveLowZoneSlotDisplay(null).status).toBe("pending");
  });
});