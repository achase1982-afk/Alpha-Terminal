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
  "WEB_SEARCH_API_KEY",
  "WEB_SEARCH_API_BASE_URL",
  "WEB_SEARCH_API_FALLBACK_KEY",
  "WEB_SEARCH_API_FALLBACK_BASE_URL",
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

  it("is disabled without WEB_SEARCH_API_KEY", () => {
    clearWebSearchEnv();
    expect(isDedicatedWebSearchApiEnabled()).toBe(false);
    expect(getPrimaryWebSearchApiConfig()).toBeNull();
  });

  it("reads primary and fallback configs", () => {
    process.env.WEB_SEARCH_API_KEY = "primary-key";
    process.env.WEB_SEARCH_API_BASE_URL = "https://search.example/v1";
    process.env.WEB_SEARCH_API_FALLBACK_KEY = "fallback-key";
    expect(isDedicatedWebSearchApiEnabled()).toBe(true);
    expect(getPrimaryWebSearchApiConfig()?.apiKey).toBe("primary-key");
    expect(getPrimaryWebSearchApiConfig()?.baseUrl).toBe("https://search.example/v1");
    expect(getFallbackWebSearchApiConfig()?.apiKey).toBe("fallback-key");
    expect(getFallbackWebSearchApiConfig()?.baseUrl).toBe("https://search.example/v1");
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

  it("uses fallback when primary returns 503", async () => {
    process.env.WEB_SEARCH_API_KEY = "primary";
    process.env.WEB_SEARCH_API_BASE_URL = "https://primary.test/search";
    process.env.WEB_SEARCH_API_FALLBACK_KEY = "fallback";
    process.env.WEB_SEARCH_API_FALLBACK_BASE_URL = "https://fallback.test/search";

    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("primary.test")) {
        return new Response("down", { status: 503 });
      }
      return Response.json({
        query: "test",
        answer: "Fallback answer",
        results: [{ title: "Example", url: "https://example.com", content: "snippet" }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await executeDedicatedWebSearch("test query");
    expect(result.endpointUsed).toBe("fallback");
    expect(result.trace.webSearchUsed).toBe(true);
    expect(result.trace.sources[0]?.url).toBe("https://example.com");
    expect(formatDedicatedWebSearchForChat(result)).toContain("Fallback answer");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("augments prompts with search block", async () => {
    process.env.WEB_SEARCH_API_KEY = "k";
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
    expect(augmented).toContain("WEB SEARCH RESULTS");
    expect(result.trace.queries).toEqual(["hello"]);
  });
});
