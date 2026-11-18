import { describe, expect, it } from "vitest";
import { resolveLowZoneSlotDisplay } from "../atLowZoneSlot";
describe("resolveLowZoneSlotDisplay", () => {
  it("returns ref top at K=35 with half-point rounding", () => {
    const d = resolveLowZoneSlotDisplay(7288.12);
    expect(d.status).toBe("ref");
    if (d.status === "ref") {
      expect(d.top).toBe(7323);
      expect(d.topLabel).toBe("7,323.0");
    }
  });

  it("returns pending when session low missing (premarket no-data)", () => {
    expect(resolveLowZoneSlotDisplay(null).status).toBe("pending");
  });
});