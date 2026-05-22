import { afterEach, describe, expect, it, vi } from "vitest";
import {
  augmentPromptWithDedicatedWebSearch,
  clampWebSearchQuery,
  executeDedicatedWebSearch,
  extractWebSearchQueryFromPrompt,
  formatDedicatedWebSearchContextBlock,
  formatDedicatedWebSearchForChat,
  getFallbackWebSearchApiConfig,
  getPrimaryWebSearchApiConfig,
  isDedicatedWebSearchApiEnabled,
  TAVILY_MAX_QUERY_CHARS,
} from "../webSearchApiClient.js";

const ENV_KEYS = [
  "TAVILY_API_KEY",
  "TAVILY_API_BASE_URL",
  "SERPER_API_KEY",
  "SERPER_API_BASE_URL",
  "WEB_SEARCH_API_KEY",
  "WEB_SEARCH_API_FALLBACK_KEY",
] as const;

function clearWebSearchEnv(): void {
  for (const k of ENV_KEYS) {
    delete process.env[k];
  }
}

describe("webSearchApiClient config", () => {
  afterEach(() => {
    clearWebSearchEnv();
    vi.unstubAllGlobals();
  });

  it("is disabled without TAVILY_API_KEY", () => {
    clearWebSearchEnv();
    expect(isDedicatedWebSearchApiEnabled()).toBe(false);
    expect(getPrimaryWebSearchApiConfig()).toBeNull();
  });

  it("reads Tavily primary and Serper fallback", () => {
    process.env.TAVILY_API_KEY = "tvly-primary";
    process.env.SERPER_API_KEY = "serper-fallback";
    expect(isDedicatedWebSearchApiEnabled()).toBe(true);
    expect(getPrimaryWebSearchApiConfig()?.provider).toBe("tavily");
    expect(getPrimaryWebSearchApiConfig()?.apiKey).toBe("tvly-primary");
    expect(getFallbackWebSearchApiConfig()?.provider).toBe("serper");
    expect(getFallbackWebSearchApiConfig()?.apiKey).toBe("serper-fallback");
    expect(getFallbackWebSearchApiConfig()?.baseUrl).toContain("serper.dev");
  });
});

describe("clampWebSearchQuery", () => {
  it("leaves short queries unchanged", () => {
    expect(clampWebSearchQuery("QBTS news")).toBe("QBTS news");
  });

  it("truncates to Tavily max length", () => {
    const long = "x".repeat(500);
    const clamped = clampWebSearchQuery(long);
    expect(clamped.length).toBeLessThanOrEqual(TAVILY_MAX_QUERY_CHARS);
    expect(clamped.length).toBeGreaterThan(0);
  });
});

describe("extractWebSearchQueryFromPrompt", () => {
  it("pulls focused catalyst query", () => {
    const q = extractWebSearchQueryFromPrompt(
      "Execute a web search focused on this exact query: AAPL analyst upgrades 2026\n\nSource priority when choosing",
    );
    expect(q).toBe("AAPL analyst upgrades 2026");
  });

  it("builds a compact query from strategist JSON data package", () => {
    const huge = JSON.stringify({
      ticker: "QBTS",
      price: 27.76,
      chain: { x: "y".repeat(8000) },
    });
    const prompt = `Run web searches then analyze.\n\n${huge}`;
    const q = extractWebSearchQueryFromPrompt(prompt);
    expect(q.length).toBeLessThanOrEqual(TAVILY_MAX_QUERY_CHARS);
    expect(q).toContain("QBTS");
    expect(q).toContain("catalyst");
  });

  it("clamps an overlong focused catalyst query", () => {
    const longQuery = "AAPL " + "analyst upgrades ".repeat(40);
    const q = extractWebSearchQueryFromPrompt(
      `Execute a web search focused on this exact query: ${longQuery}\n\nSource priority when choosing`,
    );
    expect(q.length).toBeLessThanOrEqual(TAVILY_MAX_QUERY_CHARS);
    expect(q.startsWith("AAPL")).toBe(true);
  });
});

describe("executeDedicatedWebSearch", () => {
  afterEach(() => {
    clearWebSearchEnv();
    vi.unstubAllGlobals();
  });

  it("uses Serper fallback when Tavily returns 503", async () => {
    process.env.TAVILY_API_KEY = "tvly-test";
    process.env.TAVILY_API_BASE_URL = "https://tavily.test/search";
    process.env.SERPER_API_KEY = "serper-test";
    process.env.SERPER_API_BASE_URL = "https://serper.test/search";

    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("tavily.test")) {
        return new Response("down", { status: 503 });
      }
      return Response.json({
        organic: [{ title: "Example", link: "https://example.com", snippet: "snippet" }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeDedicatedWebSearch("test query");
    expect(result.providerUsed).toBe("serper");
    expect(result.trace.dedicatedApiProvider).toBe("serper");
    expect(result.trace.sources[0]?.url).toBe("https://example.com");
    expect(formatDedicatedWebSearchForChat(result)).toContain("snippet");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("augments prompts with Tavily search block", async () => {
    process.env.TAVILY_API_KEY = "tvly-k";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          results: [{ title: "T", url: "https://t.co", content: "body" }],
        }),
      ),
    );
    const result = await executeDedicatedWebSearch("hello");
    const block = formatDedicatedWebSearchContextBlock(result);
    const augmented = augmentPromptWithDedicatedWebSearch("User task", block);
    expect(augmented).toContain("User task");
    expect(augmented).toContain("Tavily");
    expect(result.trace.queries).toEqual(["hello"]);
  });

  it("clamps overlong queries before Tavily POST body", async () => {
    process.env.TAVILY_API_KEY = "tvly-k";
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { query?: string };
      expect(body.query?.length).toBeLessThanOrEqual(TAVILY_MAX_QUERY_CHARS);
      return Response.json({ results: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    await executeDedicatedWebSearch("z".repeat(900));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
