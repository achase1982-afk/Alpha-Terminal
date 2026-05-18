import { describe, expect, it } from "vitest";
import { extractRoutingTextFromChatMessages, resolveAiChatContextSymbol } from "../aiChatContextPack.js";

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
