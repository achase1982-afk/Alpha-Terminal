import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import {
  deskTouchFeed,
  deskMarkFeedNotConfigured,
  deskMarkFeedError,
  buildDeskHealthFeeds,
  deskIsFeedStale,
  deskResetFeedFreshnessForTests,
  DESK_STALE_MS,
} from "../deskFeedFreshness.js";
import * as marketCtx from "../../getMarketContext.js";

describe("deskFeedFreshness", () => {
  beforeEach(() => {
    deskResetFeedFreshnessForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks touch and reports fresh feed", () => {
    vi.spyOn(marketCtx, "getMarketContext").mockReturnValue({
      now: "",
      timeZone: "America/New_York",
      localLabel: "",
      tradingDate: "2026-11-17",
      session: "OPEN",
      optionsLive: true,
    });
    deskTouchFeed("schwab_quotes");
    const feeds = buildDeskHealthFeeds();
    const row = feeds.find((f) => f.feed === "schwab_quotes");
    expect(row?.stale).toBe(false);
    expect(row?.last_update_ts).toBeTruthy();
  });

  it("flags stale when older than RTH quote threshold", () => {
    vi.spyOn(marketCtx, "getMarketContext").mockReturnValue({
      now: "",
      timeZone: "America/New_York",
      localLabel: "",
      tradingDate: "2026-11-17",
      session: "OPEN",
      optionsLive: true,
    });
    const old = Date.now() - DESK_STALE_MS.quotesRth - 1000;
    deskTouchFeed("schwab_quotes");
    expect(deskIsFeedStale("schwab_quotes", old)).toBe(true);
  });

  it("reports not_configured without stale flag", () => {
    deskMarkFeedNotConfigured("tradier");
    const feeds = buildDeskHealthFeeds();
    const row = feeds.find((f) => f.feed === "tradier");
    expect(row?.not_configured).toBe(true);
    expect(row?.stale).toBe(false);
  });

  it("carries error text on failed feed", () => {
    deskMarkFeedError("uw_flow", "uw_down");
    const feeds = buildDeskHealthFeeds();
    const row = feeds.find((f) => f.feed === "uw_flow");
    expect(row?.error).toBe("uw_down");
  });
});