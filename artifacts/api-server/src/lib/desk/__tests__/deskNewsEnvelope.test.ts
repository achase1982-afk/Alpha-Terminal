import { describe, expect, it } from "vitest";
import {
  buildDeskHealthFeeds,
  deskFeedEnvelopeStale,
  deskResetFeedFreshnessForTests,
  deskTouchFeedArticleAge,
  deskTouchFeedPollOk,
} from "../deskFeedFreshness.js";
import { deskEnvelope } from "../deskEnvelope.js";
import { DESK_NEWS_POLL_MS } from "../deskPollCadence.js";

describe("Finnhub news envelope stale", () => {
  it("matches health ok_no_new_articles", () => {
    deskResetFeedFreshnessForTests();
    const pollMs = Date.now();
    const articleMs = pollMs - 4 * 60 * 60 * 1000;
    deskTouchFeedPollOk("news", pollMs, "finnhub");
    deskTouchFeedArticleAge("news", articleMs, "finnhub");
    const row = buildDeskHealthFeeds().find((f) => f.feed === "news");
    expect(row?.status).toBe("ok_no_new_articles");
    expect(deskFeedEnvelopeStale("news")).toBe(false);
    const env = deskEnvelope({ articles: [] }, "finnhub", articleMs, "news");
    expect(env.stale).toBe(false);
  });

  it("stale when poll stopped", () => {
    deskResetFeedFreshnessForTests();
    const now = Date.now();
    deskTouchFeedPollOk("news", now - DESK_NEWS_POLL_MS * 3, "finnhub");
    deskTouchFeedArticleAge("news", now - 4 * 60 * 60 * 1000, "finnhub");
    expect(deskFeedEnvelopeStale("news", now)).toBe(true);
  });
});