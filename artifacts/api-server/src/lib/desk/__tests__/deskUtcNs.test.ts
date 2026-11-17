import { describe, expect, it } from "vitest";
import { deskUtcEpochNsJson } from "../deskUtcNs.js";

describe("deskUtcEpochNs", () => {
  it("returns epoch-scale nanoseconds not hrtime since boot", () => {
    const s = deskUtcEpochNsJson();
    const n = BigInt(s);
    expect(n > 1_000_000_000_000_000_000n).toBe(true);
    expect(n < 10_000_000_000_000_000_000n).toBe(true);
  });
});