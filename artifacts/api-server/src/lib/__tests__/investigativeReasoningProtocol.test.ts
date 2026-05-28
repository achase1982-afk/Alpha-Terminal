import { describe, expect, it } from "vitest";
import { buildChatSystemPrompt } from "../chatOrchestrator.js";
import { INVESTIGATIVE_REASONING_PROTOCOL } from "../investigativeReasoningProtocol.js";

describe("INVESTIGATIVE_REASONING_PROTOCOL", () => {
  it("includes verbatim trigger and step 7 honest stop", () => {
    expect(INVESTIGATIVE_REASONING_PROTOCOL).toContain(
      'TRIGGER: Use the protocol below whenever a question asks you to EXPLAIN something',
    );
    expect(INVESTIGATIVE_REASONING_PROTOCOL).toContain(
      "and your confidence level (%) plus the one thing that would change it.",
    );
    expect(INVESTIGATIVE_REASONING_PROTOCOL).toContain("Verify freshness");
    expect(INVESTIGATIVE_REASONING_PROTOCOL).toContain("Sufficiency check before answering");
  });
});

describe("buildChatSystemPrompt", () => {
  it("embeds investigative protocol for chat", () => {
    const prompt = buildChatSystemPrompt("AAPL");
    expect(prompt).toContain(INVESTIGATIVE_REASONING_PROTOCOL);
    expect(prompt).toMatch(/Extended thinking must be enabled/i);
  });
});
