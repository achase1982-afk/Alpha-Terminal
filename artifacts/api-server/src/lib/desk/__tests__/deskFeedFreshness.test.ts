import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import {
  deskTouchFeed,
  deskMarkFeedNotConfigured,
  deskMarkFeedError,
  buildDeskHealthFeeds,
  deskSummarizeFeedsHealth,
  deskIsFeedStale,
  deskResetFeedFreshnessForTests,
  deskStaleAfterMs,
} from "../deskFeedFreshness.js";
import * as marketCtx from "../../getMarketContext.js";
import * as bridge from "../deskSchwabStreamerBridge.js";

describe("deskFeedFreshness", () => {
  beforeEach(() => {
    deskResetFeedFreshnessForTests();
    vi.spyOn(bridge, "deskReadStreamerStatus").mockReturnValue("connected");
    vi.spyOn(bridge, "deskReadStreamerConnected").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("marks touch and reports fresh feed with status OK", () => {
    const now = new Date("2026-11-18T20:00:00.000Z").getTime();
    vi.useFakeTimers({ now });
    vi.spyOn(marketCtx, "getMarketContext").mockReturnValue({
      now: "",
      timeZone: "America/New_York",
      localLabel: "",
      tradingDate: "2026-11-18",
      session: "OPEN",
      optionsLive: true,
    });
    deskTouchFeed("schwab_quotes_rest", now);
    const feeds = buildDeskHealthFeeds(now);
    const row = feeds.find((f) => f.feed === "schwab_quotes_rest");
    expect(row?.stale).toBe(false);
    expect(row?.last_update_ts).toBe(now);
    expect(row?.status).toBe("OK");
    expect(row?.session_date).toBe("2026-11-18");
    expect(row?.stale_after_ms).toBe(deskStaleAfterMs("schwab_quotes_rest", now));
    vi.useRealTimers();
  });

  it("flags stale when older than threshold", () => {
    vi.spyOn(marketCtx, "getMarketContext").mockReturnValue({
      now: "",
      timeZone: "America/New_York",
      localLabel: "",
      tradingDate: "2026-11-17",
      session: "OPEN",
      optionsLive: true,
    });
    const now = Date.now();
    const old = now - deskStaleAfterMs("schwab_quotes_rest", now) - 1000;
    expect(deskIsFeedStale("schwab_quotes_rest", old, now)).toBe(true);
  });

  it("reports not_configured without stale flag", () => {
    deskMarkFeedNotConfigured("tradier");
    const feeds = buildDeskHealthFeeds();
    const row = feeds.find((f) => f.feed === "tradier");
    expect(row?.status).toBe("not_configured");
    expect(row?.stale).toBe(false);
  });

  it("does not report session_closed outside historical gamma window", () => {
    vi.spyOn(marketCtx, "getMarketContext").mockReturnValue({
      now: "",
      timeZone: "America/New_York",
      localLabel: "",
      tradingDate: "2026-11-17",
      session: "CLOSED",
      optionsLive: true,
    });
    const feeds = buildDeskHealthFeeds(new Date("2026-11-17T08:00:00-05:00").getTime());
    const row = feeds.find((f) => f.feed === "live_gamma");
    expect(row?.status).not.toBe("session_closed");
  });

  it("SPX streamer active during GTH morning", () => {
    const feeds = buildDeskHealthFeeds(new Date("2026-11-17T08:00:00-05:00").getTime());
    const row = feeds.find((f) => f.feed === "schwab_streamer");
    expect(row?.status).not.toBe("session_closed");
  });

  it("does not report session_closed on schwab_quotes_rest overnight", () => {
    const feeds = buildDeskHealthFeeds(new Date("2026-11-17T22:00:00-05:00").getTime());
    const row = feeds.find((f) => f.feed === "schwab_quotes_rest");
    expect(row?.status).not.toBe("session_closed");
  });

  it("carries error status on failed feed", () => {
    deskMarkFeedError("uw_flow", "uw_down");
    const feeds = buildDeskHealthFeeds();
    const row = feeds.find((f) => f.feed === "uw_flow");
    expect(row?.status).toBe("error");
    expect(row?.error).toBe("uw_down");
  });

  it("treats unset stocknews as not_configured and excludes it from feeds_summary", () => {
    const prevDesk = process.env.DESK_STOCKNEWS_API_KEY;
    const prev = process.env.STOCKNEWS_API_KEY;
    delete process.env.DESK_STOCKNEWS_API_KEY;
    delete process.env.STOCKNEWS_API_KEY;
    deskResetFeedFreshnessForTests();
    const feeds = buildDeskHealthFeeds();
    const row = feeds.find((f) => f.feed === "stocknews");
    expect(row?.status).toBe("not_configured");
    expect(row?.stale).toBe(false);
    expect(row?.excluded_from_health_gate).toBe(true);
    const summary = deskSummarizeFeedsHealth(feeds);
    expect(summary.gated_feeds).toContain("stocknews");
    if (prevDesk !== undefined) process.env.DESK_STOCKNEWS_API_KEY = prevDesk;
    if (prev !== undefined) process.env.STOCKNEWS_API_KEY = prev;
  });
});