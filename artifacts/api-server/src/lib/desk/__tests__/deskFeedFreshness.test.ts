import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import {
  deskTouchFeed,
  deskMarkFeedNotConfigured,
  deskMarkFeedError,
  buildDeskHealthFeeds,
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
    vi.spyOn(marketCtx, "getMarketContext").mockReturnValue({
      now: "",
      timeZone: "America/New_York",
      localLabel: "",
      tradingDate: "2026-11-17",
      session: "OPEN",
      optionsLive: true,
    });
    const now = Date.now();
    deskTouchFeed("schwab_quotes_rest", now);
    const feeds = buildDeskHealthFeeds(now);
    const row = feeds.find((f) => f.feed === "schwab_quotes_rest");
    expect(row?.stale).toBe(false);
    expect(row?.last_update_ts).toBe(now);
    expect(row?.status).toBe("OK");
    expect(row?.session_date).toBe("2026-11-17");
    expect(row?.stale_after_ms).toBe(deskStaleAfterMs("schwab_quotes_rest", now));
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

  it("uses session_closed outside gamma feed window", () => {
    vi.spyOn(marketCtx, "getMarketContext").mockReturnValue({
      now: "",
      timeZone: "America/New_York",
      localLabel: "",
      tradingDate: "2026-11-17",
      session: "CLOSED",
      optionsLive: false,
    });
    const feeds = buildDeskHealthFeeds(new Date("2026-11-17T08:00:00-05:00").getTime());
    const row = feeds.find((f) => f.feed === "live_gamma");
    expect(row?.status).toBe("session_closed");
    expect(row?.stale).toBe(false);
  });

  it("carries error status on failed feed", () => {
    deskMarkFeedError("uw_flow", "uw_down");
    const feeds = buildDeskHealthFeeds();
    const row = feeds.find((f) => f.feed === "uw_flow");
    expect(row?.status).toBe("error");
    expect(row?.error).toBe("uw_down");
  });
});