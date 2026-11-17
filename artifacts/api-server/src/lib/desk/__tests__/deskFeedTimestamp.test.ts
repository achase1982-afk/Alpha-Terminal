import { describe, expect, it } from "vitest";
import { deskCoercePollReceiptTs } from "../deskFeedTimestamp.js";

describe("deskCoercePollReceiptTs", () => {
  it("replaces UTC midnight date-only ms with poll receipt", () => {
    const pollMs = 1_763_400_000_000;
    const dateOnly = Date.parse("2026-11-17T00:00:00.000Z");
    expect(deskCoercePollReceiptTs(dateOnly, pollMs)).toBe(pollMs);
  });

  it("keeps genuine poll timestamps", () => {
    const pollMs = 1_763_400_000_000;
    expect(deskCoercePollReceiptTs(pollMs - 5000, pollMs)).toBe(pollMs - 5000);
  });
});