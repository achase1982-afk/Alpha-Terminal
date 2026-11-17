import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FINNHUB_BACKGROUND_MAX_PER_MINUTE,
  FINNHUB_BACKGROUND_SLOT_BUDGET_MS,
  FINNHUB_DESK_CALL_TIMEOUT_MS,
  FINNHUB_DESK_COMPANY_CONCURRENCY,
  FINNHUB_ONDEMAND_MAX_PER_MINUTE,
  FINNHUB_ONDEMAND_SLOT_BUDGET_MS,
} from "../deskFinnhubDeskNews.js";

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
    expect(r.lastErrorStatus).toBe(0);
    vi.useRealTimers();
  }, 15_000);

  it("background load returns within budget when rate window is full", async () => {
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
    expect(elapsed).toBeLessThanOrEqual(FINNHUB_BACKGROUND_SLOT_BUDGET_MS + 200);
    expect(r.skippedRateCap).toBe(true);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("on-demand load rate-limits within 2s when cap is full", async () => {
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
    expect(r.lastErrorStatus).toBe(429);
    expect(r.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});