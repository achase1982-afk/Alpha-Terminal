import { describe, expect, it } from "vitest";
import { dayStatusLabel, resolveDayStatus } from "../atDayStatus";

describe("atDayStatus", () => {
  it("labels down vs prior close", () => {
    expect(dayStatusLabel(resolveDayStatus({ change: -60, changePct: -0.8 }))).toBe("DAY DOWN −0.80%");
  });

  it("labels flat", () => {
    expect(dayStatusLabel(resolveDayStatus({ change: 0, changePct: 0 }))).toBe("DAY FLAT 0.00%");
  });

  it("labels missing prior close", () => {
    expect(dayStatusLabel(resolveDayStatus({ change: null, changePct: null }))).toBe("DAY —");
  });
});