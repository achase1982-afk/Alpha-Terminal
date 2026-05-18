import { describe, expect, it } from "vitest";
import {
  extractRoutingTextFromChatMessages,
  resolveAiChatContextSymbol,
  routingTextLooksLikeSessionTape,
  routingTextNamesTapeEquity,
} from "../aiChatContextPack.js";

describe("routingTextLooksLikeSessionTape", () => {
  it("detects desk phrasing for time & sales", () => {
    expect(routingTextLooksLikeSessionTape("What's the tape looking like?")).toBe(true);
    expect(routingTextLooksLikeSessionTape("How is the tape")).toBe(true);
    expect(routingTextLooksLikeSessionTape("options tape busy?")).toBe(true);
    expect(routingTextLooksLikeSessionTape("any tape prints")).toBe(true);
  });

  it("does not fire on bare TAPE ticker questions", () => {
    expect(routingTextLooksLikeSessionTape("How is TAPE doing today?")).toBe(false);
  });
});

describe("routingTextNamesTapeEquity", () => {
  it("detects explicit TAPE equity mentions", () => {
    expect(routingTextNamesTapeEquity("shares of TAPE")).toBe(true);
    expect(routingTextNamesTapeEquity("TAPE stock chart")).toBe(true);
    expect(routingTextNamesTapeEquity("buy TAPE")).toBe(true);
  });
});

describe("resolveAiChatContextSymbol tape jargon", () => {
  it("routes session-tape questions to the page symbol", () => {
    expect(resolveAiChatContextSymbol("NOW", "What's the tape looking like?")).toBe("NOW");
    expect(resolveAiChatContextSymbol("AAPL", "Read the tape on flow")).toBe("AAPL");
  });

  it("still routes bare TAPE to the ticker when user means the equity", () => {
    expect(resolveAiChatContextSymbol("MSFT", "How is TAPE doing today?")).toBe("TAPE");
  });

  it("prefers $TAPE when the user forces that ticker", () => {
    expect(resolveAiChatContextSymbol("NOW", "What's the tape for $TAPE")).toBe("TAPE");
  });

  it("does not hijack TAPE equity questions that also mention the tape", () => {
    expect(resolveAiChatContextSymbol("NOW", "Shares of TAPE — also how is the tape")).toBe("TAPE");
  });

  it("uses multi-turn routing text for symbol carryover", () => {
    const routing = extractRoutingTextFromChatMessages([
      { role: "user", content: "Focus on $GOOG" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "What's the tape looking like?" },
    ]);
    expect(resolveAiChatContextSymbol("NOW", routing)).toBe("GOOG");
  });
});
