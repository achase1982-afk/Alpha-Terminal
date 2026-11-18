import { describe, expect, it } from "vitest";
import { buildSchwabOptionKey } from "../optionsSchwabKey";

describe("buildSchwabOptionKey", () => {
  it("parses full ISO-8601 expiration strings with timezone offsets without returning empty", () => {
    expect(buildSchwabOptionKey("$SPX", "2026-11-18T21:00:00.000+00:00", 7340, "C")).toBe(
      "SPX   261118C07340000",
    );
    expect(buildSchwabOptionKey("AAPL", "2026-11-20T05:00:00.000Z", 225.5, "P")).toBe(
      "AAPL  261120P00225500",
    );
  });

  it("parses plain YYYY-MM-DD and Schwab colon-suffixed dates without UTC day shift", () => {
    expect(buildSchwabOptionKey("SPY", "2026-11-18:0", 600, "C")).toBe("SPY   261118C00600000");
    expect(buildSchwabOptionKey("SPX", "2026-11-17", 7545, "C")).toBe("SPX   261117C07545000");
  });
});
