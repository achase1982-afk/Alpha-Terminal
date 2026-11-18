import { describe, expect, it } from "vitest";
import { resolveHighZoneSlotDisplay } from "../atHighZoneSlot";

describe("resolveHighZoneSlotDisplay", () => {
  it("high zone bottom at k=0.4%", () => {
    const z = resolveHighZoneSlotDisplay(7368);
    expect(z.status).toBe("value");
    if (z.status === "value") expect(z.bottom).toBe(7338.5);
  });
});