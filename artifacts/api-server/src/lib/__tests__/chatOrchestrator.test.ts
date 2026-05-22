import { describe, expect, it } from "vitest";

function etInstant(
  y: number,
  m: number,
  d: number,
  hour: number,
  minute: number,
): Date {
  const ymd = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const isDst = m >= 3 && m <= 10;
  const off = isDst ? "-04:00" : "-05:00";
  return new Date(`${ymd}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${off}`);
}
import {
  buildChatSystemPrompt,
  buildModelMessagesFromHistory,
  CHAT_MAX_TOOL_STEPS,
  CHAT_SUMMARY_TOKEN_THRESHOLD,
  EMPTY_CHAT_RESPONSE_AFTER_TOOLS,
  EMPTY_CHAT_RESPONSE_PLAIN,
  formatEmptyChatResponseMessage,
  shouldSummarizeThread,
} from "../chatOrchestrator.js";
import { estimateTokenCount } from "../chatDb.js";
import { createChatTools } from "../chatTools/index.js";

describe("buildChatSystemPrompt", () => {
  it("uses GOOGL as ambient default for this stock questions", () => {
    const prompt = buildChatSystemPrompt("GOOGL");
    expect(prompt).toContain("GOOGL");
    expect(prompt).toContain('"this stock"');
    expect(prompt).not.toContain("routing to ticker");
    expect(prompt).not.toContain("ONLY use the Context Data blocks");
  });

  it("instructs inline clarification for ambiguous tickers", () => {
    const prompt = buildChatSystemPrompt("GOOGL");
    expect(prompt.toLowerCase()).toContain("ask the user");
    expect(prompt).toMatch(/disambiguate/i);
  });

  it("allows general knowledge without symbol", () => {
    const prompt = buildChatSystemPrompt(null);
    expect(prompt).toContain("Answer general questions");
    expect(prompt).not.toContain("Data ticker");
  });

  it("documents web_search API routing", () => {
    const prompt = buildChatSystemPrompt("AAPL");
    expect(prompt).toContain("TAVILY_API_KEY");
    expect(prompt).toContain("SERPER_API_KEY");
    expect(prompt).toMatch(/provider-native|Claude|Gemini|OpenAI/i);
  });

  it("instructs catalyst answers to use terminal news before claiming no news", () => {
    const prompt = buildChatSystemPrompt("QBTS");
    expect(prompt).toContain("Recent headlines");
    expect(prompt).toContain("get_news");
    expect(prompt).toContain("web_search");
    expect(prompt).toMatch(/do \*\*not\*\* claim there is no material same-day news/i);
  });

  it("documents merged News tab feed for get_news", () => {
    const prompt = buildChatSystemPrompt("AAPL");
    expect(prompt).toContain("merged News tab feed");
    expect(prompt).toContain("Polygon, Benzinga, Finnhub");
  });

  it("includes absolute formatting rules to avoid AI-tell structure", () => {
    const prompt = buildChatSystemPrompt("AAPL");
    expect(prompt).toContain("Formatting. Write in plain prose");
    expect(prompt).toContain("No section dividers");
    expect(prompt).toContain("No emoji anywhere");
    expect(prompt).toContain('No label-colon section headers such as "Bottom line:"');
    expect(prompt).toContain("Avoid em dashes");
    expect(prompt).toContain("Do not impose a fixed report template");
  });

  it("includes authoritative ET market context (not UTC server clock)", () => {
    const at105Et = etInstant(2026, 5, 21, 13, 5);
    const prompt = buildChatSystemPrompt(null, "America/New_York", at105Et);
    expect(prompt).toContain("MARKET CONTEXT — authoritative");
    expect(prompt).toContain("Session: OPEN");
    expect(prompt).toMatch(/1:05.*ET/i);
    expect(prompt).not.toMatch(/5:05/);
    expect(prompt).not.toContain("toLocaleString");
  });
});

describe("formatEmptyChatResponseMessage", () => {
  it("explains tool-step exhaustion when tools ran", () => {
    expect(formatEmptyChatResponseMessage(true)).toBe(EMPTY_CHAT_RESPONSE_AFTER_TOOLS);
  });

  it("uses plain placeholder when no tools ran", () => {
    expect(formatEmptyChatResponseMessage(false)).toBe(EMPTY_CHAT_RESPONSE_PLAIN);
  });
});

describe("CHAT_MAX_TOOL_STEPS", () => {
  it("allows enough steps for multi-ticker tool loops", () => {
    expect(CHAT_MAX_TOOL_STEPS).toBeGreaterThanOrEqual(15);
  });
});

describe("shouldSummarizeThread", () => {
  it("triggers at 80k tokens", () => {
    expect(shouldSummarizeThread(CHAT_SUMMARY_TOKEN_THRESHOLD - 1)).toBe(false);
    expect(shouldSummarizeThread(CHAT_SUMMARY_TOKEN_THRESHOLD + 1)).toBe(true);
  });
});

describe("buildModelMessagesFromHistory", () => {
  it("prepends thread summary instead of old messages", () => {
    const msgs = buildModelMessagesFromHistory(
      [
        {
          id: "1",
          threadId: "t",
          role: "user",
          content: "old question",
          toolCalls: null,
          toolResults: null,
          tokenCount: 100,
          createdAt: new Date(),
        },
      ],
      "User asked about NVDA earnings.",
    );
    expect(msgs[0]?.role).toBe("user");
    expect(String(msgs[0]?.content)).toContain("Prior conversation summary");
    expect(String(msgs[0]?.content)).toContain("NVDA");
  });
});

describe("createChatTools", () => {
  it("exposes expected tool names", () => {
    const tools = createChatTools({ userId: "u1", activeModel: "claude-opus-4-7" });
    expect(Object.keys(tools).sort()).toEqual(
      [
        "get_analyst_ratings",
        "get_earnings",
        "get_flow",
        "get_ivr",
        "get_market_pulse",
        "get_news",
        "get_options_chain",
        "get_quote",
        "get_technicals",
        "web_fetch",
        "web_search",
      ].sort(),
    );
  });
});

describe("estimateTokenCount", () => {
  it("estimates from character length", () => {
    expect(estimateTokenCount("abcd")).toBeGreaterThan(0);
    expect(estimateTokenCount("")).toBe(0);
  });
});
