import { describe, expect, it } from "vitest";
import { stripLegacyEmptyAccessTokenQuery } from "@workspace/api-client-react";

describe("stripLegacyEmptyAccessTokenQuery", () => {
  it("removes empty accessToken query param", () => {
    expect(
      stripLegacyEmptyAccessTokenQuery("/api/market/quote?symbol=AAPL&accessToken="),
    ).toBe("/api/market/quote?symbol=AAPL");
  });

  it("removes whitespace-only accessToken", () => {
    expect(
      stripLegacyEmptyAccessTokenQuery("/api/market/quote?accessToken=%20&symbol=SPY"),
    ).toBe("/api/market/quote?symbol=SPY");
  });

  it("preserves non-empty accessToken for legacy clients", () => {
    const url = "/api/market/quote?symbol=AAPL&accessToken=jwt-legacy";
    expect(stripLegacyEmptyAccessTokenQuery(url)).toBe(url);
  });

  it("leaves URLs without query unchanged", () => {
    expect(stripLegacyEmptyAccessTokenQuery("/api/healthz")).toBe("/api/healthz");
  });
});
