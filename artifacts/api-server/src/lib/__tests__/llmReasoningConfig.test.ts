import { describe, expect, it } from "vitest";
import {
  googleThinkingProviderOptionsForAiSdk,
  openAiReasoningProviderOptionsForChat,
} from "../llmReasoningConfig.js";
import { geminiThinkingConfigForModel } from "../geminiThinkingConfig.js";

describe("geminiThinkingConfigForModel", () => {
  it("enables thinking for gemini-3.5-flash", () => {
    const cfg = geminiThinkingConfigForModel("gemini-3.5-flash");
    expect(cfg).toBeDefined();
    expect(cfg?.includeThoughts).toBe(true);
    expect(cfg?.thinkingBudget).toBe(-1);
    expect(cfg).not.toHaveProperty("thinkingLevel");
  });
});

describe("openAiReasoningProviderOptionsForChat", () => {
  it("uses high effort for gpt-5.5", () => {
    expect(openAiReasoningProviderOptionsForChat("gpt-5.5")).toEqual({
      openai: { reasoningEffort: "high" },
    });
  });

  it("uses medium effort for gpt-5.4-mini", () => {
    expect(openAiReasoningProviderOptionsForChat("gpt-5.4-mini")).toEqual({
      openai: { reasoningEffort: "medium" },
    });
  });
});

describe("googleThinkingProviderOptionsForAiSdk", () => {
  it("maps gemini-3.5-flash thinking into AI SDK google options", () => {
    const opts = googleThinkingProviderOptionsForAiSdk("gemini-3.5-flash");
    expect(opts?.google.thinkingConfig?.includeThoughts).toBe(true);
    expect(opts?.google.thinkingConfig?.thinkingBudget).toBe(-1);
    expect(opts?.google.thinkingConfig).not.toHaveProperty("thinkingLevel");
  });
});
