import { describe, expect, it } from "vitest";
import { resolveLowZoneSlotDisplay } from "../atLowZoneSlot";

describe("resolveLowZoneSlotDisplay", () => {
  it("returns pending when numbers disabled", () => {
    expect(resolveLowZoneSlotDisplay(7288).status).toBe("pending");
  });
});