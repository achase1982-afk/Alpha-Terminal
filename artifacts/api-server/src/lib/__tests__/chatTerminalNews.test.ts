import { describe, expect, it } from "vitest";
import {
  formatChatNewsLine,
  formatChatTerminalNewsBlock,
} from "../chatTerminalNews.js";
import type { NormalizedArticle } from "../tickerNewsAggregated.js";

function article(partial: Partial<NormalizedArticle> & Pick<NormalizedArticle, "headline" | "datetime">): NormalizedArticle {
  return {
    id: 1,
    source: "BENZINGA",
    summary: "",
    url: "https://example.com/a",
    image: "",
    related: "QBTS",
    ...partial,
  };
}

describe("formatChatNewsLine", () => {
  it("tags same-day ET headlines with [TODAY]", () => {
    const todaySec = Math.floor(new Date("2026-05-22T14:00:00-04:00").getTime() / 1000);
    const line = formatChatNewsLine(
      article({ headline: "D-Wave surges on quantum deal", datetime: todaySec }),
      "2026-05-22",
    );
    expect(line).toContain("[TODAY]");
    expect(line).toContain("D-Wave surges");
  });

  it("omits wire source names by default", () => {
    const sec = Math.floor(new Date("2026-05-22T14:00:00-04:00").getTime() / 1000);
    const line = formatChatNewsLine(
      article({ headline: "IPO mandate story", datetime: sec }),
      "2026-05-22",
    );
    expect(line).not.toContain("BENZINGA");
    expect(line).toContain("IPO mandate story");
  });

  it("can include source when requested for debugging payloads", () => {
    const sec = Math.floor(new Date("2026-05-22T14:00:00-04:00").getTime() / 1000);
    const line = formatChatNewsLine(
      article({ headline: "IPO mandate story", datetime: sec }),
      "2026-05-22",
      { includeSource: true },
    );
    expect(line).toContain("BENZINGA");
  });

  it("omits [TODAY] for prior-day headlines", () => {
    const priorSec = Math.floor(new Date("2026-05-20T14:00:00-04:00").getTime() / 1000);
    const line = formatChatNewsLine(
      article({ headline: "Older quantum note", datetime: priorSec }),
      "2026-05-22",
    );
    expect(line).not.toContain("[TODAY]");
  });
});

describe("formatChatTerminalNewsBlock", () => {
  it("lists headlines newest-first block", () => {
    const block = formatChatTerminalNewsBlock("QBTS", [
      article({ headline: "Big move today", datetime: Math.floor(Date.now() / 1000) }),
      article({ headline: "Prior week story", datetime: Math.floor(new Date("2026-05-15T12:00:00Z").getTime() / 1000) }),
    ]);
    expect(block).toContain("internal");
    expect(block).not.toContain("BENZINGA");
    expect(block).toContain("Big move today");
    expect(block).toContain("Prior week story");
  });

  it("reports empty feed plainly", () => {
    expect(formatChatTerminalNewsBlock("QBTS", [])).toContain("none available");
  });
});
