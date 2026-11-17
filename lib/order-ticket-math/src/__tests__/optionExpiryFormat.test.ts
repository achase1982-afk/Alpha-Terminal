import { describe, expect, it } from "vitest";
import { formatOptionExpirationHuman, parseContractExpiration } from "../optionExpiryFormat.js";

describe("optionExpiryFormat", () => {
  it("parses contract date without timezone shift", () => {
    expect(parseContractExpiration("2026-11-18T21:00:00")).toEqual({ y: 2026, m: 10, d: 18 });
  });

  it("formats full expiry for ticket header", () => {
    expect(formatOptionExpirationHuman("2026-11-18", "header")).toBe("November 18, 2026 expiry");
  });
});