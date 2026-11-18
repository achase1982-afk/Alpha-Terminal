import { describe, expect, it } from "vitest";
import { resolveDayHighFromStreamQuote } from "../atDayHigh";

describe("resolveDayHighFromStreamQuote", () => {
  it("returns current high in session", () => {
    const q = {
      high: 7368.44,
      low: 7288,
      change: 1,
      changePct: 0.1,
      close: 7300,
      last: 7340,
    } as const;
    const d = resolveDayHighFromStreamQuote(q);
    expect(d.kind).toBe("current");
    expect(d.value).toBe(7368.44);
  });
});