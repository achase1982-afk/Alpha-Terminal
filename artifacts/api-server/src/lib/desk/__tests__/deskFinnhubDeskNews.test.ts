import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FINNHUB_BACKGROUND_MAX_PER_MINUTE,
  FINNHUB_BACKGROUND_SLOT_BUDGET_MS,
  FINNHUB_DESK_CALL_TIMEOUT_MS,
  FINNHUB_DESK_COMPANY_CONCURRENCY,
  FINNHUB_ONDEMAND_MAX_PER_MINUTE,
  FINNHUB_ONDEMAND_SLOT_BUDGET_MS,
} from "../deskFinnhubDeskNews.js";

const FINNHUB_FETCH_LATENCY_MS = 250;

describe("deskLoadFinnhubDeskArticles transport", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.FINNHUB_API_KEY = "test-key";
  });

  it("runs company-news fetches with bounded concurrency", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 30));
        inFlight -= 1;
        return new Response(JSON.stringify([]), { status: 200 });
      }),
    );
    const mod = await import("../deskFinnhubDeskNews.js");
    mod.deskResetFinnhubRateLimitForTests();
    await mod.deskLoadFinnhubDeskArticles(
      ["A", "B", "C", "D", "E", "F", "G", "H"],
      "ondemand",
    );
    expect(maxInFlight).toBeLessThanOrEqual(FINNHUB_DESK_COMPANY_CONCURRENCY);
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(1);
  });

  it("aborts hung fetch at 5s with fake timers", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) {
            reject(new DOMException("The operation was aborted.", "AbortError"));
            return;
          }
          signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        });
      }),
    );
    const mod = await import("../deskFinnhubDeskNews.js");
    mod.deskResetFinnhubRateLimitForTests();
    const loadPromise = mod.deskLoadFinnhubDeskArticles(["SPY"], "ondemand");
    await vi.advanceTimersByTimeAsync(FINNHUB_DESK_CALL_TIMEOUT_MS + 200);
    const r = await loadPromise;
    expect(r.hadHttp2xx).toBe(false);
    vi.useRealTimers();
  }, 15_000);

  it("background default poll completes all 11 calls with 250ms latency and records health", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fetchMock = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, FINNHUB_FETCH_LATENCY_MS));
      return new Response(JSON.stringify([{ datetime: 1, headline: "x" }]), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { deskResetFeedFreshnessForTests, buildDeskHealthFeeds } = await import("../deskFeedFreshness.js");
    const { deskResetFinnhubPollFailureStreakForTests, deskFetchNews } = await import("../deskNews.js");
    const modFinnhub = await import("../deskFinnhubDeskNews.js");
    modFinnhub.deskResetFinnhubRateLimitForTests();
    deskResetFeedFreshnessForTests();
    deskResetFinnhubPollFailureStreakForTests();
    const pollPromise = deskFetchNews([], { mode: "background" });
    await vi.runAllTimersAsync();
    const poll = await pollPromise;
    expect(fetchMock).toHaveBeenCalledTimes(11);
    expect(poll.ok).toBe(true);
    const row = buildDeskHealthFeeds().find((f) => f.feed === "news");
    expect(row?.stale).toBe(false);
    expect(row?.status).not.toBe("error");
    vi.useRealTimers();
  });

  it("background load returns within per-call slot budget when rate window is full", async () => {
    const now = Date.now();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
    );
    const mod = await import("../deskFinnhubDeskNews.js");
    mod.deskSimulateFinnhubRateSlotsForTests("ondemand", FINNHUB_ONDEMAND_MAX_PER_MINUTE, now);
    mod.deskSimulateFinnhubRateSlotsForTests("background", FINNHUB_BACKGROUND_MAX_PER_MINUTE, now, false);
    const started = Date.now();
    const r = await mod.deskLoadFinnhubDeskArticles(["SPY"], "background");
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThanOrEqual(FINNHUB_BACKGROUND_SLOT_BUDGET_MS * 2 + 200);
    expect(r.skippedRateCap).toBe(true);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("on-demand load rate-limits within 2s when cap is full without health side effects", async () => {
    const now = Date.now();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
    );
    const mod = await import("../deskFinnhubDeskNews.js");
    mod.deskSimulateFinnhubRateSlotsForTests("ondemand", FINNHUB_ONDEMAND_MAX_PER_MINUTE, now);
    const started = Date.now();
    const r = await mod.deskLoadFinnhubDeskArticles(["SPY"], "ondemand");
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThanOrEqual(FINNHUB_ONDEMAND_SLOT_BUDGET_MS + 200);
    expect(r.clientRateLimited).toBe(true);
    expect(r.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();

    const { deskResetFeedFreshnessForTests, buildDeskHealthFeeds } = await import("../deskFeedFreshness.js");
    const { deskResetFinnhubPollFailureStreakForTests, deskFetchNews } = await import("../deskNews.js");
    deskResetFeedFreshnessForTests();
    deskResetFinnhubPollFailureStreakForTests();
    const news = await deskFetchNews(["SPY"]);
    expect(news.ok).toBe(false);
    const row = buildDeskHealthFeeds().find((f) => f.feed === "news");
    expect(row?.status).not.toBe("rate_limited");
  });
});
