import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FINNHUB_DESK_CALL_TIMEOUT_MS,
  FINNHUB_DESK_COMPANY_CONCURRENCY,
  deskResetFinnhubRateLimitForTests,
} from "../deskFinnhubDeskNews.js";

describe("deskLoadFinnhubDeskArticles transport", () => {
  beforeEach(() => {
    deskResetFinnhubRateLimitForTests();
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
    const { deskLoadFinnhubDeskArticles } = await import("../deskFinnhubDeskNews.js");
    await deskLoadFinnhubDeskArticles([
      "A",
      "B",
      "C",
      "D",
      "E",
      "F",
      "G",
      "H",
    ]);
    expect(maxInFlight).toBeLessThanOrEqual(FINNHUB_DESK_COMPANY_CONCURRENCY);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("uses a short per-call HTTP timeout", async () => {
    const signalSpy = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const signal = init?.signal;
        if (signal) signalSpy(signal);
        return new Response(JSON.stringify([]), { status: 200 });
      }),
    );
    const { deskLoadFinnhubDeskArticles } = await import("../deskFinnhubDeskNews.js");
    await deskLoadFinnhubDeskArticles(["SPY"]);
    expect(signalSpy).toHaveBeenCalled();
    expect(FINNHUB_DESK_CALL_TIMEOUT_MS).toBe(5_000);
  });
});