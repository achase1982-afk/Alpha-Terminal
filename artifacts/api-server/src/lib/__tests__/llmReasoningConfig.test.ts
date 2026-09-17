import { describe, expect, it } from "vitest";
import {
  anthropicOpusMessageExtras,
  anthropicProviderOptionsForAiSdk,
  anthropicThinkingForMessagesApi,
  googleThinkingProviderOptionsForAiSdk,
  isAnthropicAdaptiveThinkingModel,
  isOpenAiReasoningModel,
  openAiReasoningEffortForModel,
  openAiReasoningProviderOptionsForChat,
} from "../llmReasoningConfig.js";
import { geminiThinkingConfigForModel } from "../geminiThinkingConfig.js";
import {
  isAnthropicOpusEffortModel,
  isAnthropicOpusSpeedModel,
  isAnthropicTemperatureConfigurable,
  migrateLegacyModelIdToCatalog,
  normalizeAiModelId,
  parseClaudeModelVersion,
} from "@workspace/ai-models";

describe("geminiThinkingConfigForModel", () => {
  it("uses thinkingLevel (not the deprecated budget) for gemini-3.8-flash", () => {
    const cfg = geminiThinkingConfigForModel("gemini-3.8-flash");
    expect(cfg).toBeDefined();
    expect(cfg?.includeThoughts).toBe(true);
    expect(cfg?.thinkingLevel).toBe("high");
    expect(cfg).not.toHaveProperty("thinkingBudget");
  });

  it("uses thinkingLevel for gemini-3.1-pro-preview", () => {
    expect(geminiThinkingConfigForModel("gemini-3.1-pro-preview")?.thinkingLevel).toBe("high");
  });

  it("keeps the dynamic budget for gemini-2.5 models", () => {
    const cfg = geminiThinkingConfigForModel("gemini-2.5-flash");
    expect(cfg?.thinkingBudget).toBe(-1);
    expect(cfg).not.toHaveProperty("thinkingLevel");
  });
});

describe("isOpenAiReasoningModel / openAiReasoningEffortForModel", () => {
  it("treats GPT-6.x and GPT-5.x as reasoning models", () => {
    expect(isOpenAiReasoningModel("gpt-6-astra")).toBe(true);
    expect(isOpenAiReasoningModel("gpt-5.6-terra")).toBe(true);
    expect(isOpenAiReasoningModel("gpt-5.5")).toBe(true);
    expect(isOpenAiReasoningModel("o4-mini")).toBe(true);
    expect(isOpenAiReasoningModel("gpt-4o")).toBe(false);
    expect(isOpenAiReasoningModel("gpt-5-chat-latest")).toBe(false);
  });

  it("runs flagship models at high effort and the rest at medium", () => {
    expect(openAiReasoningEffortForModel("gpt-6-astra")).toBe("high");
    expect(openAiReasoningEffortForModel("gpt-5.5")).toBe("high");
    expect(openAiReasoningEffortForModel("gpt-5.6-sol")).toBe("high");
    expect(openAiReasoningEffortForModel("gpt-5.6-terra")).toBe("medium");
    expect(openAiReasoningEffortForModel("gpt-5.6-luna")).toBe("medium");
    expect(openAiReasoningEffortForModel("gpt-5.4-mini")).toBe("medium");
  });
});

describe("openAiReasoningProviderOptionsForChat", () => {
  it("uses high effort for gpt-6-astra and forces reasoning handling in the AI SDK", () => {
    expect(openAiReasoningProviderOptionsForChat("gpt-6-astra")).toEqual({
      openai: { forceReasoning: true, reasoningEffort: "high" },
    });
  });

  it("uses medium effort for gpt-5.6-terra", () => {
    expect(openAiReasoningProviderOptionsForChat("gpt-5.6-terra")).toEqual({
      openai: { forceReasoning: true, reasoningEffort: "medium" },
    });
  });

  it("keeps forceReasoning (no explicit effort) when thinking is disabled", () => {
    expect(openAiReasoningProviderOptionsForChat("gpt-6-astra", { enabled: false })).toEqual({
      openai: { forceReasoning: true },
    });
  });

  it("returns undefined for non-reasoning models", () => {
    expect(openAiReasoningProviderOptionsForChat("gpt-4o")).toBeUndefined();
  });
});

describe("Anthropic model gating", () => {
  it("parses Claude model ids", () => {
    expect(parseClaudeModelVersion("claude-opus-5")).toEqual({ family: "opus", major: 5, minor: 0 });
    expect(parseClaudeModelVersion("claude-fable-5-1")).toEqual({ family: "fable", major: 5, minor: 1 });
    expect(parseClaudeModelVersion("claude-opus-4-8")).toEqual({ family: "opus", major: 4, minor: 8 });
    expect(parseClaudeModelVersion("claude-sonnet-4-7-20250514")).toEqual({ family: "sonnet", major: 4, minor: 7 });
    expect(parseClaudeModelVersion("claude-opus-4-20250514")).toEqual({ family: "opus", major: 4, minor: 0 });
    expect(parseClaudeModelVersion("claude-3-5-sonnet-20241022")).toBeNull();
    expect(parseClaudeModelVersion("gpt-6-astra")).toBeNull();
  });

  it("uses adaptive thinking for Opus 5, Sonnet 5, Fable 5.1 and Opus/Sonnet 4.7+", () => {
    for (const m of ["claude-opus-5", "claude-sonnet-5", "claude-fable-5-1", "claude-fable-5", "claude-opus-4-8", "claude-opus-4-7"]) {
      expect(isAnthropicAdaptiveThinkingModel(m), m).toBe(true);
      expect(anthropicThinkingForMessagesApi(m), m).toEqual({ type: "adaptive", display: "summarized" });
    }
    expect(isAnthropicAdaptiveThinkingModel("claude-sonnet-4-6")).toBe(false);
    expect(isAnthropicAdaptiveThinkingModel("claude-haiku-4-5")).toBe(false);
    expect(anthropicThinkingForMessagesApi("claude-haiku-4-5")).toBeUndefined();
  });

  it("supports effort on Opus 5 / Fable 5.1 but not Sonnet 5; fast mode only on Opus", () => {
    expect(isAnthropicOpusEffortModel("claude-opus-5")).toBe(true);
    expect(isAnthropicOpusEffortModel("claude-fable-5-1")).toBe(true);
    expect(isAnthropicOpusEffortModel("claude-sonnet-5")).toBe(false);
    expect(isAnthropicOpusSpeedModel("claude-opus-5")).toBe(true);
    expect(isAnthropicOpusSpeedModel("claude-fable-5-1")).toBe(false);
  });

  it("rejects custom temperature on 5.x models", () => {
    expect(isAnthropicTemperatureConfigurable("claude-opus-5")).toBe(false);
    expect(isAnthropicTemperatureConfigurable("claude-sonnet-5")).toBe(false);
    expect(isAnthropicTemperatureConfigurable("claude-fable-5-1")).toBe(false);
    expect(isAnthropicTemperatureConfigurable("claude-haiku-4-5")).toBe(true);
    expect(isAnthropicTemperatureConfigurable("gpt-6-astra")).toBe(true);
  });
});

describe("legacy model id migration", () => {
  it("remaps retired catalog ids onto the current catalog", () => {
    expect(migrateLegacyModelIdToCatalog("claude-opus-4-8")).toBe("claude-opus-5");
    expect(migrateLegacyModelIdToCatalog("claude-sonnet-4-6")).toBe("claude-sonnet-5");
    expect(migrateLegacyModelIdToCatalog("claude-fable-5")).toBe("claude-fable-5-1");
    expect(migrateLegacyModelIdToCatalog("gemini-3.5-flash")).toBe("gemini-3.8-flash");
    expect(migrateLegacyModelIdToCatalog("gemini-3.1-pro-preview")).toBe("gemini-3.1-pro-preview");
    expect(migrateLegacyModelIdToCatalog("gpt-5.5")).toBe("gpt-6-astra");
    expect(migrateLegacyModelIdToCatalog("gpt-5.4-mini")).toBe("gpt-5.6-terra");
    expect(migrateLegacyModelIdToCatalog("unknown-model")).toBe("claude-opus-5");
  });

  it("normalizeAiModelId remaps legacy ids instead of collapsing them to the default", () => {
    expect(normalizeAiModelId("gpt-5.5")).toBe("gpt-6-astra");
    expect(normalizeAiModelId(undefined)).toBe("claude-opus-5");
  });
});

describe("anthropicProviderOptionsForAiSdk", () => {
  it("includes adaptive thinking and effort for claude-opus-5", () => {
    const opts = anthropicProviderOptionsForAiSdk("claude-opus-5", { effort: "xhigh" });
    expect(opts?.providerOptions.anthropic.thinking).toEqual({ type: "adaptive" });
    expect(opts?.providerOptions.anthropic.effort).toBe("xhigh");
  });

  it("sets speed fast when requested", () => {
    const opts = anthropicProviderOptionsForAiSdk("claude-opus-5", { speed: "fast" });
    expect(opts?.providerOptions.anthropic.speed).toBe("fast");
  });

  it("uses adaptive thinking without opus extras for claude-sonnet-5", () => {
    const opts = anthropicProviderOptionsForAiSdk("claude-sonnet-5", { effort: "max" });
    expect(opts?.providerOptions.anthropic.thinking).toEqual({ type: "adaptive" });
    expect(opts?.providerOptions.anthropic.effort).toBeUndefined();
    expect(anthropicOpusMessageExtras("claude-sonnet-5", { effort: "max" })).toEqual({});
  });

  it("sets output_config.effort for Opus", () => {
    expect(anthropicOpusMessageExtras("claude-opus-5", { effort: "low" })?.output_config?.effort).toBe("low");
  });

  it("sets top-level speed fast for Opus Messages API", () => {
    const extras = anthropicOpusMessageExtras("claude-opus-5", { speed: "fast" });
    expect(extras.speed).toBe("fast");
    expect(extras.output_config?.effort).toBe("high");
  });

  it("includes adaptive thinking and effort for claude-fable-5-1", () => {
    const opts = anthropicProviderOptionsForAiSdk("claude-fable-5-1", { effort: "max" });
    expect(opts?.providerOptions.anthropic.thinking).toEqual({ type: "adaptive" });
    expect(opts?.providerOptions.anthropic.effort).toBe("max");
    expect(opts?.providerOptions.anthropic.speed).toBeUndefined();
  });

  it("ignores fast speed for claude-fable-5-1", () => {
    const opts = anthropicProviderOptionsForAiSdk("claude-fable-5-1", { speed: "fast" });
    expect(opts?.providerOptions.anthropic.speed).toBeUndefined();
    expect(anthropicOpusMessageExtras("claude-fable-5-1", { speed: "fast" }).speed).toBeUndefined();
  });
});

describe("googleThinkingProviderOptionsForAiSdk", () => {
  it("maps gemini-3.8-flash thinking into AI SDK google options", () => {
    const opts = googleThinkingProviderOptionsForAiSdk("gemini-3.8-flash");
    expect(opts?.google.thinkingConfig?.includeThoughts).toBe(true);
    expect(opts?.google.thinkingConfig?.thinkingLevel).toBe("high");
    expect(opts?.google.thinkingConfig).not.toHaveProperty("thinkingBudget");
  });
});
