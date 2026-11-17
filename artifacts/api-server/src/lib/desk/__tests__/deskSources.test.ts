import { describe, expect, it } from "vitest";
import { deskResolveSource } from "../deskSources.js";

describe("deskResolveSource", () => {
  it("rejects missing source", () => {
    const r = deskResolveSource(undefined, ["schwab", "tradier"] as const);
    expect("error" in r).toBe(true);
    if ("error" in r) {
      expect(r.error).toContain("required");
    }
  });

  it("accepts explicit allowed source", () => {
    const r = deskResolveSource("tradier", ["schwab", "tradier"] as const);
    expect("error" in r).toBe(false);
    if (!("error" in r)) expect(r.source).toBe("tradier");
  });

  it("rejects unsupported source", () => {
    const r = deskResolveSource("yahoo", ["schwab"] as const);
    expect("error" in r).toBe(true);
  });
});