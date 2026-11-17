import { beforeEach, describe, expect, it } from "vitest";
import {
  buildDeskHealthFeeds,
  deskMarkFeedRateLimited,
  deskResetFeedFreshnessForTests,
  deskTouchFeedArticleAge,
  deskMarkFeedOkNoNewArticles,
  deskTouchFeedPollOk,
} from "../deskFeedFreshness.js";
import { DESK_NEWS_POLL_MS } from "../deskPollCadence.js";

describe("desk news / alphavantage health", () => {
  beforeEach(() => deskResetFeedFreshnessForTests());

  it("finnhub ok_no_new_articles only with fresh poll", () => {
    const oldMs = Date.now() - 4 * 60 * 60 * 1000;
    const pollMs = Date.now();
    deskTouchFeedPollOk("news", pollMs, "finnhub");
    deskTouchFeedArticleAge("news", oldMs, "finnhub");
    deskMarkFeedOkNoNewArticles("news", "finnhub_no_new_articles_age_14400s", "finnhub", oldMs);
    const row = buildDeskHealthFeeds().find((f) => f.feed === "news");
    expect(row?.status).toBe("ok_no_new_articles");
    expect(row?.stale).toBe(false);
  });

  it("stale article without recent poll is not ok_no_new_articles", () => {
    const oldMs = Date.now() - 4 * 60 * 60 * 1000;
    deskTouchFeedPollOk("news", Date.now() - DESK_NEWS_POLL_MS * 3, "finnhub");
    deskTouchFeedArticleAge("news", oldMs, "finnhub");
    const row = buildDeskHealthFeeds().find((f) => f.feed === "news");
    expect(row?.status).not.toBe("ok_no_new_articles");
  });

  it("alphavantage rate_limited is not stale", () => {
    deskMarkFeedRateLimited("alphavantage", "alphavantage_daily_cap", "alphavantage");
    const row = buildDeskHealthFeeds().find((f) => f.feed === "alphavantage");
    expect(row?.status).toBe("rate_limited");
    expect(row?.stale).toBe(false);
  });
});