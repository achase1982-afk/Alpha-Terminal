import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDeskHealthFeeds,
  deskMarkFeedOnDemand,
  deskMarkFeedRateLimited,
  deskResetFeedFreshnessForTests,
  deskTouchFeedOnDemand,
} from "../deskFeedFreshness.js";

describe("desk news / alphavantage health", () => {
  beforeEach(() => deskResetFeedFreshnessForTests());

  it("alphavantage stays on_demand after touch, not stale 15 minutes later", () => {
    vi.useFakeTimers();
    const t0 = Date.parse("2026-06-02T15:00:00.000Z");
    vi.setSystemTime(t0);
    deskResetFeedFreshnessForTests();
    deskMarkFeedOnDemand("alphavantage", "alphavantage");
    deskTouchFeedOnDemand("alphavantage", t0, "alphavantage");
    let row = buildDeskHealthFeeds(t0).find((f) => f.feed === "alphavantage")!;
    expect(row.status).toBe("on_demand");
    expect(row.stale).toBe(false);
    vi.setSystemTime(t0 + 20 * 60 * 1000);
    row = buildDeskHealthFeeds(t0 + 20 * 60 * 1000).find((f) => f.feed === "alphavantage")!;
    expect(row.status).toBe("on_demand");
    expect(row.stale).toBe(false);
    vi.useRealTimers();
  });

  it("alphavantage rate_limited is not stale", () => {
    deskMarkFeedRateLimited("alphavantage", "alphavantage_daily_cap", "alphavantage");
    const row = buildDeskHealthFeeds().find((f) => f.feed === "alphavantage");
    expect(row?.status).toBe("rate_limited");
    expect(row?.stale).toBe(false);
  });

  it("alphavantage day rollover stays on_demand after first fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 500 })),
    );
    vi.useFakeTimers();
    const day1 = Date.parse("2026-06-02T15:00:00.000Z");
    vi.setSystemTime(day1);
    deskResetFeedFreshnessForTests();
    deskMarkFeedOnDemand("alphavantage", "alphavantage");
    const day2 = Date.parse("2026-06-03T15:00:00.000Z");
    vi.setSystemTime(day2);
    process.env.ALPHAVANTAGE_API_KEY = "test-key";
    const { deskFetchAlphaVantageNews } = await import("../deskAlphaVantage.js");
    await deskFetchAlphaVantageNews(["SPY"]);
    const row = buildDeskHealthFeeds(day2).find((f) => f.feed === "alphavantage");
    expect(row?.status).toBe("on_demand");
    expect(row?.stale).toBe(false);
    vi.useRealTimers();
  });
});
