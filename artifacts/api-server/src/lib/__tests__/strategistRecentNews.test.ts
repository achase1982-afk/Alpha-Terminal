import { describe, expect, it } from "vitest";
import { truncateSummaryWordBoundary } from "../strategistRecentNews.js";

describe("truncateSummaryWordBoundary", () => {
  it("returns null for empty", () => {
    expect(truncateSummaryWordBoundary(null, 280)).toBeNull();
    expect(truncateSummaryWordBoundary("   ", 280)).toBeNull();
  });

  it("does not truncate short text", () => {
    expect(truncateSummaryWordBoundary("hello world", 280)).toBe("hello world");
  });

  it("never exceeds maxLen including ellipsis", () => {
    const long = "word ".repeat(200).trim();
    const out = truncateSummaryWordBoundary(long, 280);
    expect(out).toBeTruthy();
    expect(out!.length).toBeLessThanOrEqual(280);
    expect(out!.endsWith("…")).toBe(true);
  });
});
