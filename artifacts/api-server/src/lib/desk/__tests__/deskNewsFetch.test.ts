import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDeskHealthFeeds,
  deskResetFeedFreshnessForTests,
} from "../deskFeedFreshness.js";
import { DESK_NEWS_POLL_MS } from "../deskPollCadence.js";

const loadMock = vi.fn();

vi.mock("../deskFinnhubDeskNews.js", () => ({
  deskLoadFinnhubDeskArticles: (...args: unknown[]) => loadMock(...args),
}));

describe("deskFetchNews Finnhub health", () => {
  beforeEach(() => {
    deskResetFeedFreshnessForTests();
    loadMock.mockReset();
    process.env.FINNHUB_API_KEY = "test-key";
  });

  it("successful poll with 4h-old articles yields ok_no_new_articles", async () => {
    const articleMs = Date.now() - 4 * 60 * 60 * 1000;
    loadMock.mockResolvedValue({
      articles: [{ datetime: Math.floor(articleMs / 1000), headline: "old" }],
      hadHttp2xx: true,
    });
    const { deskFetchNews } = await import("../deskNews.js");
    await deskFetchNews(["SPY"]);
    const row = buildDeskHealthFeeds().find((f) => f.feed === "news");
    expect(row?.status).toBe("ok_no_new_articles");
    expect(row?.stale).toBe(false);
  });

  it("poll stopped for >2 intervals yields stale", async () => {
    const { deskTouchFeedArticleAge, deskTouchFeedPollOk } = await import("../deskFeedFreshness.js");
    const now = Date.now();
    deskTouchFeedPollOk("news", now - DESK_NEWS_POLL_MS * 3, "finnhub");
    deskTouchFeedArticleAge("news", now - 4 * 60 * 60 * 1000, "finnhub");
    const row = buildDeskHealthFeeds(now).find((f) => f.feed === "news");
    expect(row?.status).toBe("stale");
  });

  it("429 poll yields rate_limited", async () => {
    loadMock.mockResolvedValue({
      articles: [],
      hadHttp2xx: false,
      lastErrorStatus: 429,
    });
    const { deskFetchNews } = await import("../deskNews.js");
    await deskFetchNews(["SPY"]);
    const row = buildDeskHealthFeeds().find((f) => f.feed === "news");
    expect(row?.status).toBe("rate_limited");
    expect(row?.source).toBe("finnhub");
  });

  it("401 poll yields auth_error", async () => {
    loadMock.mockResolvedValue({
      articles: [],
      hadHttp2xx: false,
      lastErrorStatus: 401,
    });
    const { deskFetchNews } = await import("../deskNews.js");
    await deskFetchNews(["SPY"]);
    const row = buildDeskHealthFeeds().find((f) => f.feed === "news");
    expect(row?.status).toBe("auth_error");
    expect(row?.source).toBe("finnhub");
  });
});
