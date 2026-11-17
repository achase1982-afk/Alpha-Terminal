import { beforeEach, describe, expect, it } from "vitest";
import {
  buildDeskHealthFeeds,
  deskMarkFeedRateLimited,
  deskResetFeedFreshnessForTests,
} from "../deskFeedFreshness.js";

describe("desk news / alphavantage health", () => {
  beforeEach(() => deskResetFeedFreshnessForTests());

  it("alphavantage rate_limited is not stale", () => {
    deskMarkFeedRateLimited("alphavantage", "alphavantage_daily_cap", "alphavantage");
    const row = buildDeskHealthFeeds().find((f) => f.feed === "alphavantage");
    expect(row?.status).toBe("rate_limited");
    expect(row?.stale).toBe(false);
  });
});
