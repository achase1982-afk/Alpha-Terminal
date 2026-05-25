import { describe, expect, it } from "vitest";
import type { MoversNewsHeadline } from "../fmpMoversNews.js";
import { buildHeadlineSetKey } from "../moversTier2Cache.js";

function headline(title: string): MoversNewsHeadline {
  return { symbol: "FUTU", publishedAt: "2026-05-24T10:00:00Z", title, source: "", kind: "news" };
}

describe("buildHeadlineSetKey", () => {
  it("is stable regardless of headline order", () => {
    const a = [headline("Alpha news"), headline("Beta report")];
    const b = [headline("Beta report"), headline("Alpha news")];
    expect(buildHeadlineSetKey(a)).toBe(buildHeadlineSetKey(b));
  });

  it("changes when the title set changes", () => {
    const before = [headline("Alpha news")];
    const after = [headline("Alpha news"), headline("New catalyst headline")];
    expect(buildHeadlineSetKey(before)).not.toBe(buildHeadlineSetKey(after));
  });

  it("does not include publishedAt in the key", () => {
    const h1 = [headline("Same title")];
    const h2 = [
      { ...headline("Same title"), publishedAt: "2026-01-01T00:00:00Z" },
    ];
    expect(buildHeadlineSetKey(h1)).toBe(buildHeadlineSetKey(h2));
  });
});
