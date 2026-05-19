import { describe, expect, it } from "vitest";
import {
  extractRoutingTextFromChatMessages,
  resolveAiChatContextSymbol,
  routingTextIsPageContextualQuestion,
} from "../aiChatContextPack.js";

describe("extractRoutingTextFromChatMessages", () => {
  it("joins last user turns for routing", () => {
    const routing = extractRoutingTextFromChatMessages([
      { role: "user", content: "What is AAPL doing?" },
      { role: "assistant", content: "Up 1%." },
      { role: "user", content: "Pull options flow" },
    ]);
    expect(routing).toContain("AAPL");
    expect(routing).toContain("Pull options flow");
  });

  it("drops trailing synthesizer pseudo-turn", () => {
    const synth = "You are the final **synthesizer** — merge drafts.";
    const routing = extractRoutingTextFromChatMessages([
      { role: "user", content: "$MSFT levels" },
      { role: "user", content: synth },
    ]);
    expect(routing).toContain("MSFT");
    expect(routing).not.toContain("synthesizer");
  });
});

describe("resolveAiChatContextSymbol with multi-turn routing", () => {
  it("keeps $MSFT when follow-up has no ticker", () => {
    const text = extractRoutingTextFromChatMessages([
      { role: "user", content: "Check $MSFT levels for today" },
      { role: "user", content: "Now show options flow only please" },
    ]);
    expect(resolveAiChatContextSymbol("NVDA", text)).toBe("MSFT");
  });
});

describe("routingTextIsPageContextualQuestion", () => {
  it("detects deictic stock advice without a named ticker", () => {
    expect(routingTextIsPageContextualQuestion("Is this a good stock to buy?")).toBe(true);
    expect(routingTextIsPageContextualQuestion("Should I buy this")).toBe(true);
    expect(routingTextIsPageContextualQuestion("Is it worth holding?")).toBe(true);
  });

  it("does not fire when the user names a ticker with $", () => {
    expect(routingTextIsPageContextualQuestion("Is $AAPL a good buy?")).toBe(false);
  });
});

describe("resolveAiChatContextSymbol contextual page questions", () => {
  it("routes 'Is this a good stock to buy?' to the open page symbol (not TO from 'to buy')", () => {
    expect(resolveAiChatContextSymbol("GOOGL", "Is this a good stock to buy?")).toBe("GOOGL");
  });

  it("still routes explicit $tickers over the page", () => {
    expect(resolveAiChatContextSymbol("GOOGL", "Is $MSFT a better buy than this?")).toBe("MSFT");
  });

  it("still routes bare ticker mentions when not contextual", () => {
    expect(resolveAiChatContextSymbol("GOOGL", "How is NVDA doing today?")).toBe("NVDA");
  });
});
