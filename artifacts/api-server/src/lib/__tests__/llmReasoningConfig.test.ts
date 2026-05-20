import { describe, expect, it } from "vitest";
import {
  googleThinkingProviderOptionsForAiSdk,
  openAiReasoningProviderOptionsForChat,
} from "../llmReasoningConfig.js";
import { geminiThinkingConfigForModel } from "../geminiThinkingConfig.js";

describe("geminiThinkingConfigForModel", () => {
  it("uses thinkingLevel only for gemini-3.5-flash (not budget)", () => {
    const cfg = geminiThinkingConfigForModel("gemini-3.5-flash");
    expect(cfg).toBeDefined();
    expect(cfg?.includeThoughts).toBe(true);
    expect("thinkingLevel" in cfg!).toBe(true);
    expect("thinkingBudget" in cfg!).toBe(false);
  });

  it("uses thinkingBudget only for gemini-3.1-pro-preview", () => {
    const cfg = geminiThinkingConfigForModel("gemini-3.1-pro-preview");
    expect(cfg).toBeDefined();
    expect(cfg?.includeThoughts).toBe(true);
    expect("thinkingBudget" in cfg!).toBe(true);
    expect("thinkingBudget" in cfg! && cfg.thinkingBudget).toBe(-1);
    expect("thinkingLevel" in cfg!).toBe(false);
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
  it("maps gemini-3.5-flash with thinkingLevel only", () => {
    const opts = googleThinkingProviderOptionsForAiSdk("gemini-3.5-flash");
    const tc = opts?.google.thinkingConfig;
    expect(tc?.includeThoughts).toBe(true);
    expect(tc?.thinkingLevel).toBe("medium");
    expect(tc?.thinkingBudget).toBeUndefined();
  });

  it("maps gemini-3.1-pro-preview with thinkingBudget only", () => {
    const opts = googleThinkingProviderOptionsForAiSdk("gemini-3.1-pro-preview");
    const tc = opts?.google.thinkingConfig;
    expect(tc?.includeThoughts).toBe(true);
    expect(tc?.thinkingBudget).toBe(-1);
    expect(tc?.thinkingLevel).toBeUndefined();
  });
});
