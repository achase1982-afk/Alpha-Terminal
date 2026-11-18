import { describe, expect, it } from "vitest";
import { dayStatusLabel, resolveDayStatus } from "../atDayStatus";

describe("resolveDayStatus", () => {
  it("formats down day", () => {
    const d = resolveDayStatus({ change: -58, changePct: -0.8 });
    expect(d.kind).toBe("down");
    expect(dayStatusLabel(d)).toBe("DAY DOWN −0.80%");
  });

  it("missing pct", () => {
    expect(resolveDayStatus({ change: null, changePct: null }).kind).toBe("unavailable");
  });
});