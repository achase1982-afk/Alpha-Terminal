import { describe, expect, it } from "vitest";
import { normalizeFinnhubArticle } from "../../lib/tickerNewsAggregated.js";

describe("Finnhub news normalization", () => {
  it("keeps direct publisher URLs", () => {
    const article = normalizeFinnhubArticle({
      id: 1,
      category: "company",
      datetime: 1710000000,
      headline: "Direct article",
      image: "https://example.com/image.jpg",
      related: "AAPL",
      source: "Reuters",
      summary: "Summary",
      url: "https://www.reuters.com/markets/test-story",
    });

    expect(article.url).toBe("https://www.reuters.com/markets/test-story");
    expect(article.source).toBe("REUTERS");
  });

  it("suppresses Finnhub wrapper URLs that cannot open full article content", () => {
    const article = normalizeFinnhubArticle({
      id: 2,
      category: "company",
      datetime: 1710000000,
      headline: "Wrapped article",
      image: "",
      related: "AAPL",
      source: "Finnhub",
      summary: "Summary",
      url: "https://finnhub.io/api/news?id=abc123",
    });

    expect(article.url).toBe("");
  });
});
