import { beforeEach, describe, expect, it } from "vitest";
import {
  buildDeskHealthFeeds,
  deskMarkFeedRateLimited,
  deskResetFeedFreshnessForTests,
  deskTouchFeedArticleAge,
  deskMarkFeedOkNoNewArticles,
} from "../deskFeedFreshness.js";

describe("desk news / alphavantage health", () => {
  beforeEach(() => deskResetFeedFreshnessForTests());

  it("finnhub ok_no_new_articles keeps real age and is not stale", () => {
    const oldMs = Date.now() - 4 * 60 * 60 * 1000;
    deskTouchFeedArticleAge("news", oldMs, "finnhub");
    deskMarkFeedOkNoNewArticles("news", "finnhub_no_new_articles_age_14400s", "finnhub", oldMs);
    const row = buildDeskHealthFeeds().find((f) => f.feed === "news");
    expect(row?.status).toBe("ok_no_new_articles");
    expect(row?.stale).toBe(false);
    expect(row?.last_update_ts).toBe(oldMs);
  });

  it("alphavantage rate_limited is not stale", () => {
    deskMarkFeedRateLimited("alphavantage", "alphavantage_daily_cap", "alphavantage");
    const row = buildDeskHealthFeeds().find((f) => f.feed === "alphavantage");
    expect(row?.status).toBe("rate_limited");
    expect(row?.stale).toBe(false);
  });
});