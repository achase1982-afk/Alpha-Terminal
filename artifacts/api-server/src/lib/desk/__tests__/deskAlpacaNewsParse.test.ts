import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deskMaxArticlePublishedMs } from "../deskNewsArticleAge.js";

const here = dirname(fileURLToPath(import.meta.url));
const payload = JSON.parse(
  readFileSync(join(here, "fixtures", "alpaca-news.json"), "utf8"),
) as { news: unknown[] };

describe("desk Alpaca news fixture", () => {
  it("parses v1beta1 news array and article published time", () => {
    const articles = payload.news;
    expect(articles.length).toBeGreaterThan(0);
    const ms = deskMaxArticlePublishedMs(articles);
    expect(ms).toBe(Date.parse("2026-11-17T14:00:00Z"));
  });
});