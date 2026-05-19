import { describe, expect, it } from "vitest";
import {
  buildChatSystemPrompt,
  buildModelMessagesFromHistory,
  CHAT_SUMMARY_TOKEN_THRESHOLD,
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
    const tools = createChatTools({ userId: "u1" });
    expect(Object.keys(tools).sort()).toEqual(
      [
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
