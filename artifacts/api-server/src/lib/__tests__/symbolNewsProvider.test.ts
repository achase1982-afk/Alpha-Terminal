import { afterEach, describe, expect, it, vi } from "vitest";
import { alpacaNewsSymbol, fetchAlpacaNews, fetchSymbolNews } from "../symbolNewsProvider.js";

const log = { warn: vi.fn(), info: vi.fn() };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  delete process.env.ALPACA_API_KEY_ID;
  delete process.env.ALPACA_API_SECRET_KEY;
  delete process.env.FINNHUB_API_KEY;
});

describe("alpacaNewsSymbol", () => {
  it("maps index products onto liquid underlyings Alpaca can query", () => {
    expect(alpacaNewsSymbol("$SPX")).toBe("SPY");
    expect(alpacaNewsSymbol("aapl")).toBe("AAPL");
    expect(alpacaNewsSymbol("/ESZ6")).toBe("ES");
  });
});

describe("fetchSymbolNews", () => {
  it("uses Finnhub and does not call Alpaca when Finnhub has headlines", async () => {
    process.env.ALPACA_API_KEY_ID = "key";
    process.env.ALPACA_API_SECRET_KEY = "secret";
    process.env.FINNHUB_API_KEY = "finn";
    const fetchMock = vi.fn(async (url: string) => {
      expect(String(url)).toContain("finnhub.io/api/v1/company-news");
      return {
        ok: true,
        json: async () => [
          {
            id: 9,
            category: "company",
            datetime: 1763388000,
            headline: "Desk headline",
            image: "",
            related: "AAPL",
            source: "Reuters",
            summary: "Summary",
            url: "https://example.com/story",
          },
        ],
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const articles = await fetchSymbolNews("AAPL", log);
    expect(articles).toHaveLength(1);
    expect(articles[0]?.headline).toBe("Desk headline");
    expect(articles[0]?.source).toBe("REUTERS");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not call Alpaca when ALPACA keys are unset", async () => {
    process.env.FINNHUB_API_KEY = "finn";
    const fetchMock = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchSymbolNews("AAPL", log)).resolves.toEqual([]);
    const urls = fetchMock.mock.calls.map((c) => String(c.at(0)));
    expect(urls.some((u) => u.includes("alpaca"))).toBe(false);
    expect(urls.some((u) => u.includes("finnhub.io"))).toBe(true);
  });

  it("uses Alpaca only after Finnhub is empty and ALPACA keys exist", async () => {
    process.env.ALPACA_API_KEY_ID = "key";
    process.env.ALPACA_API_SECRET_KEY = "secret";
    process.env.FINNHUB_API_KEY = "finn";
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("finnhub")) return { ok: true, json: async () => [] };
      return {
        ok: true,
        json: async () => ({
          news: [
            {
              id: 3,
              headline: "Alpaca fill-in",
              summary: "",
              created_at: "2026-11-17T14:00:00Z",
              url: "https://example.com/a",
              source: "benzinga",
              symbols: ["AAPL"],
            },
          ],
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    const articles = await fetchSymbolNews("AAPL", log);
    expect(articles.map((a) => a.headline)).toEqual(["Alpaca fill-in"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns [] without throwing when Finnhub errors and Alpaca is unset", async () => {
    process.env.FINNHUB_API_KEY = "finn";
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network");
    }));
    await expect(fetchSymbolNews("MSFT", log)).resolves.toEqual([]);
  });
});

describe("fetchAlpacaNews", () => {
  it("returns [] on non-200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    await expect(fetchAlpacaNews("AAPL", "k", "s", log)).resolves.toEqual([]);
  });
});
