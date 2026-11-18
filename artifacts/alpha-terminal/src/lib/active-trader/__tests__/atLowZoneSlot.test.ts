import { describe, expect, it } from "vitest";
import { resolveLowZoneSlotDisplay } from "../atLowZoneSlot";

describe("resolveLowZoneSlotDisplay", () => {
  it("returns unavailable when low missing", () => {
    expect(resolveLowZoneSlotDisplay(null).status).toBe("unavailable");
  });

  it("computes low zone top", () => {
    const d = resolveLowZoneSlotDisplay(7288);
    expect(d.status).toBe("value");
    if (d.status === "value") expect(d.top).toBe(7323);
  });
});