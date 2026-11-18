import { describe, expect, it } from "vitest";
import { buildSchwabPriceHistoryParams, parseDeskBarIsoDate } from "../deskSchwabBars.js";

describe("parseDeskBarIsoDate", () => {
  it("parses YYYY-MM-DD start of day ET", () => {
    const ms = parseDeskBarIsoDate("2010-01-01");
    expect(ms).toBe(Date.parse("2010-01-01T00:00:00-05:00"));
  });

  it("parses end of day ET", () => {
    const ms = parseDeskBarIsoDate("2010-12-31", true);
    expect(ms).toBe(Date.parse("2010-12-31T23:59:59.999-05:00"));
  });
});

describe("buildSchwabPriceHistoryParams", () => {
  it("defaults to 1y daily when no range", () => {
    const p = buildSchwabPriceHistoryParams("$SPX", "1d");
    expect(p?.get("periodType")).toBe("year");
    expect(p?.get("period")).toBe("1");
    expect(p?.get("frequencyType")).toBe("daily");
    expect(p?.has("startDate")).toBe(false);
  });

  it("passes startDate/endDate for ranged 1d", () => {
    const startMs = parseDeskBarIsoDate("2010-01-01")!;
    const endMs = parseDeskBarIsoDate("2026-11-18", true)!;
    const p = buildSchwabPriceHistoryParams("$SPX", "1d", { startMs, endMs });
    expect(p?.get("startDate")).toBe(String(startMs));
    expect(p?.get("endDate")).toBe(String(endMs));
    expect(p?.get("periodType")).toBe("year");
    expect(p?.get("period")).toBe("20");
  });

  it("short range uses mapped period", () => {
    const startMs = parseDeskBarIsoDate("2025-01-01")!;
    const endMs = parseDeskBarIsoDate("2025-06-01", true)!;
    const p = buildSchwabPriceHistoryParams("SPY", "1d", { startMs, endMs });
    expect(p?.get("periodType")).toBe("year");
    expect(p?.get("period")).toBe("1");
  });
});