import { afterEach, describe, expect, it, vi } from "vitest";
import {
  augmentPromptWithDedicatedWebSearch,
  executeDedicatedWebSearch,
  extractWebSearchQueryFromPrompt,
  formatDedicatedWebSearchContextBlock,
  formatDedicatedWebSearchForChat,
  getFallbackWebSearchApiConfig,
  getPrimaryWebSearchApiConfig,
  isDedicatedWebSearchApiEnabled,
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

describe("extractWebSearchQueryFromPrompt", () => {
  it("pulls focused catalyst query", () => {
    const q = extractWebSearchQueryFromPrompt(
      "Execute a web search focused on this exact query: AAPL analyst upgrades 2026\n\nSource priority when choosing",
    );
    expect(q).toBe("AAPL analyst upgrades 2026");
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
});
