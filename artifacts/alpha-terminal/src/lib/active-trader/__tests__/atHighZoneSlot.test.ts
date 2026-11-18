import { describe, expect, it } from "vitest";
import { resolveHighZoneSlotDisplay } from "../atHighZoneSlot";

describe("resolveHighZoneSlotDisplay", () => {
  it("returns unavailable when high missing", () => {
    expect(resolveHighZoneSlotDisplay(null).status).toBe("unavailable");
  });

  it("computes high zone bottom from running high", () => {
    const d = resolveHighZoneSlotDisplay(7400.37);
    expect(d.status).toBe("value");
    if (d.status === "value") expect(d.bottom).toBe(7365.5);
  });
});