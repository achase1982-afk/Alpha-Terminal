import { describe, expect, it } from "vitest";
import {
  anthropicOpusMessageExtras,
  anthropicProviderOptionsForAiSdk,
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

describe("anthropicProviderOptionsForAiSdk", () => {
  it("includes adaptive thinking and effort for claude-opus-4-8", () => {
    const opts = anthropicProviderOptionsForAiSdk("claude-opus-4-8", { effort: "xhigh" });
    expect(opts?.providerOptions.anthropic.thinking).toEqual({ type: "adaptive" });
    expect(opts?.providerOptions.anthropic.effort).toBe("xhigh");
  });

  it("sets speed fast when requested", () => {
    const opts = anthropicProviderOptionsForAiSdk("claude-opus-4-8", { speed: "fast" });
    expect(opts?.providerOptions.anthropic.speed).toBe("fast");
  });

  it("omits opus extras for non-Opus models", () => {
    expect(anthropicOpusMessageExtras("claude-sonnet-4-6", { effort: "max" })).toEqual({});
  });

  it("sets output_config.effort for Opus", () => {
    expect(anthropicOpusMessageExtras("claude-opus-4-8", { effort: "low" })?.output_config?.effort).toBe("low");
  });

  it("sets top-level speed fast for Opus Messages API", () => {
    const extras = anthropicOpusMessageExtras("claude-opus-4-8", { speed: "fast" });
    expect(extras.speed).toBe("fast");
    expect(extras.output_config?.effort).toBe("high");
  });

  it("includes adaptive thinking and effort for claude-fable-5", () => {
    const opts = anthropicProviderOptionsForAiSdk("claude-fable-5", { effort: "max" });
    expect(opts?.providerOptions.anthropic.thinking).toEqual({ type: "adaptive" });
    expect(opts?.providerOptions.anthropic.effort).toBe("max");
    expect(opts?.providerOptions.anthropic.speed).toBeUndefined();
  });

  it("ignores fast speed for claude-fable-5", () => {
    const opts = anthropicProviderOptionsForAiSdk("claude-fable-5", { speed: "fast" });
    expect(opts?.providerOptions.anthropic.speed).toBeUndefined();
    expect(anthropicOpusMessageExtras("claude-fable-5", { speed: "fast" }).speed).toBeUndefined();
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
