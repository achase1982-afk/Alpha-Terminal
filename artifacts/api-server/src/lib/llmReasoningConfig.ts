import type Anthropic from "@anthropic-ai/sdk";
import {
  type AnthropicOpusCallOptions,
  type AnthropicOpusEffort,
  type AnthropicOpusSpeed,
  DEFAULT_ANTHROPIC_OPUS_EFFORT,
  DEFAULT_ANTHROPIC_OPUS_SPEED,
  isAnthropicAdaptiveThinkingModel,
  isAnthropicOpusEffortModel,
  isAnthropicOpusSpeedModel,
  isOpenAiReasoningModel,
  normalizeAnthropicOpusEffort,
  normalizeAnthropicOpusSpeed,
  openAiReasoningEffortForModel,
  type OpenAiReasoningEffort,
} from "@workspace/ai-models";
import { geminiThinkingConfigForModel, type GeminiThinkingLevel } from "./geminiThinkingConfig.js";

export { isAnthropicAdaptiveThinkingModel, isOpenAiReasoningModel, openAiReasoningEffortForModel };

/** SDK types may lag API (`xhigh`); runtime accepts all catalog effort levels. */
function anthropicSdkOutputConfig(effort: AnthropicOpusEffort): Anthropic.OutputConfig {
  return { effort: effort as Anthropic.OutputConfig["effort"] };
}

/**
 * Central defaults for provider-native reasoning / extended thinking across the stack.
 * Anthropic: Messages API `thinking`; Vercel AI SDK `providerOptions.anthropic.thinking`.
 * xAI: `providerOptions.xai.reasoningEffort` (chat: low|high; responses: low|medium|high).
 */

/** Budget for Claude `thinking: { type: "enabled", budget_tokens }` (non-adaptive models). */
export const ANTHROPIC_EXTENDED_THINKING_BUDGET = 4096;

/**
 * Adaptive-thinking gate lives in `@workspace/ai-models` (`isAnthropicAdaptiveThinkingModel`):
 * Opus 5, Sonnet 5, Fable 5.x and Opus/Sonnet 4.7+ use `thinking: { type: "adaptive" }`;
 * `budget_tokens` returns 400 on those models.
 */

/** @deprecated Prefer isAnthropicAdaptiveThinkingModel — kept for existing call sites. */
export const isClaude47OrNewer = isAnthropicAdaptiveThinkingModel;

export function isAnthropicExtendedThinkingCapableModel(model: string): boolean {
  if (!/^claude-/i.test(model)) return false;
  // Claude 3.x does not accept the same `@ai-sdk/anthropic` thinking payload as 4.x; sending it causes hard API errors.
  if (/^claude-3-/i.test(model)) return false;
  // Haiku models do not use the same extended-thinking path as Opus/Sonnet in our Anthropic integration.
  if (/haiku/i.test(model)) return false;
  return true;
}

export type AnthropicMessagesApiThinking =
  | { type: "adaptive"; display: "summarized" }
  | { type: "enabled"; budget_tokens: number };

export function anthropicThinkingForMessagesApi(model: string): AnthropicMessagesApiThinking | undefined {
  if (!isAnthropicExtendedThinkingCapableModel(model)) return undefined;
  if (isAnthropicAdaptiveThinkingModel(model)) {
    return { type: "adaptive", display: "summarized" };
  }
  return { type: "enabled", budget_tokens: ANTHROPIC_EXTENDED_THINKING_BUDGET };
}

type AnthropicAiSdkProviderOptions = {
  providerOptions: {
    anthropic: {
      thinking?: { type: "adaptive" } | { type: "enabled"; budgetTokens: number };
      effort?: Anthropic.OutputConfig["effort"];
      speed?: "fast" | "standard";
    };
  };
};

/** Native Messages API extras for Opus (`output_config.effort`, top-level `speed`). */
export type AnthropicOpusMessageExtras = {
  output_config?: Anthropic.OutputConfig;
  speed?: "fast";
};

function resolveAnthropicOpusCallOptions(
  model: string,
  opus?: AnthropicOpusCallOptions | null,
): { effort: AnthropicOpusEffort | null; speed: AnthropicOpusSpeed | null } {
  if (!isAnthropicOpusEffortModel(model)) {
    return { effort: null, speed: null };
  }
  return {
    effort: normalizeAnthropicOpusEffort(opus?.effort ?? DEFAULT_ANTHROPIC_OPUS_EFFORT),
    speed: normalizeAnthropicOpusSpeed(opus?.speed ?? DEFAULT_ANTHROPIC_OPUS_SPEED),
  };
}

/**
 * Vercel AI SDK `@ai-sdk/anthropic`: spread into `streamText` / `generateText`.
 * Pass Opus options for `output_config.effort` and `speed: "fast"`.
 */
export type ChatExtendedThinkingOptions = {
  /** When false, omit provider-native reasoning/thinking for chat turns. Default true. */
  enabled?: boolean;
};

export function anthropicProviderOptionsForAiSdk(
  model: string,
  opus?: AnthropicOpusCallOptions | null,
  thinking?: ChatExtendedThinkingOptions | null,
): AnthropicAiSdkProviderOptions | undefined {
  if (!isAnthropicExtendedThinkingCapableModel(model)) return undefined;
  const { effort: resolvedEffort, speed: resolvedSpeed } = resolveAnthropicOpusCallOptions(model, opus);

  const anthropic: AnthropicAiSdkProviderOptions["providerOptions"]["anthropic"] = {};
  const thinkingOn = thinking?.enabled !== false;
  if (thinkingOn) {
    if (isAnthropicAdaptiveThinkingModel(model)) {
      anthropic.thinking = { type: "adaptive" };
    } else {
      anthropic.thinking = { type: "enabled", budgetTokens: ANTHROPIC_EXTENDED_THINKING_BUDGET };
    }
  }
  if (resolvedEffort) {
    anthropic.effort = resolvedEffort as Anthropic.OutputConfig["effort"];
  }
  if (resolvedSpeed === "fast" && isAnthropicOpusSpeedModel(model)) {
    anthropic.speed = "fast";
  }

  return { providerOptions: { anthropic } };
}

/** Native `@anthropic-ai/sdk` Messages API extras for Opus effort + fast mode. */
export function anthropicOpusMessageExtras(
  model: string,
  opus?: AnthropicOpusCallOptions | null,
): AnthropicOpusMessageExtras {
  const { effort: resolvedEffort, speed: resolvedSpeed } = resolveAnthropicOpusCallOptions(model, opus);
  if (!resolvedEffort && resolvedSpeed !== "fast") {
    return {};
  }
  return {
    ...(resolvedEffort
      ? { output_config: anthropicSdkOutputConfig(resolvedEffort) }
      : {}),
    ...(resolvedSpeed === "fast" && isAnthropicOpusSpeedModel(model) ? { speed: "fast" as const } : {}),
  };
}

/** @deprecated Use anthropicOpusMessageExtras */
export function anthropicMessagesOutputConfig(
  model: string,
  effort?: AnthropicOpusEffort | null,
): AnthropicOpusMessageExtras {
  return anthropicOpusMessageExtras(model, { effort });
}

export type XaiReasoningProviderOptions = { xai: { reasoningEffort: "low" | "medium" | "high" } };

export type XaiChatReasoningProviderOptions = { xai: { reasoningEffort: "low" | "high" } };

type XaiReasoningTier = "low" | "medium" | "high";

function xaiReasoningTier(model: string): XaiReasoningTier | null {
  if (!model.startsWith("grok-")) return null;
  if (model.includes("non-reasoning")) return "low";
  const isHighEffortReasoningName =
    (model.includes("reasoning") && !model.includes("non-reasoning"))
    || /grok-4-1-fast-reasoning|grok-4-fast-reasoning|grok-4\.20-0309-reasoning|grok-4\.20-multi-agent/.test(
      model,
    );
  if (isHighEffortReasoningName) return "high";
  return "medium";
}

/** xAI Responses API (`xai.responses`) — supports low / medium / high. */
export function xaiReasoningProviderOptions(model: string): XaiReasoningProviderOptions | undefined {
  const tier = xaiReasoningTier(model);
  if (tier == null) return undefined;
  return { xai: { reasoningEffort: tier } };
}

/**
 * xAI chat-language-model (`xai("grok-…")`) — only `low` and `high` are valid.
 * Maps internal `medium` tier to `high` so default Grok models still use reasoning.
 */
export function xaiReasoningProviderOptionsForChat(
  model: string,
  thinking?: ChatExtendedThinkingOptions | null,
): XaiChatReasoningProviderOptions | undefined {
  if (thinking?.enabled === false) return undefined;
  const tier = xaiReasoningTier(model);
  if (tier == null) return undefined;
  return { xai: { reasoningEffort: tier === "low" ? "low" : "high" } };
}

export type OpenAiChatReasoningProviderOptions = {
  openai: {
    /**
     * `@ai-sdk/openai` only auto-detects `gpt-5*` / o-series as reasoning models; GPT-6.x would
     * otherwise be sent `temperature` (rejected) and `max_tokens` instead of `max_completion_tokens`.
     */
    forceReasoning: true;
    reasoningEffort?: OpenAiReasoningEffort;
  };
};

/**
 * OpenAI reasoning models (GPT-6.x / GPT-5.x / o-series) via AI SDK `providerOptions.openai`.
 * Returns undefined for non-reasoning models. With thinking disabled the explicit effort is
 * dropped (model default) but `forceReasoning` stays on so unsupported sampling params are stripped.
 */
export function openAiReasoningProviderOptionsForChat(
  model: string,
  thinking?: ChatExtendedThinkingOptions | null,
): OpenAiChatReasoningProviderOptions | undefined {
  if (!isOpenAiReasoningModel(model)) return undefined;
  if (thinking?.enabled === false) return { openai: { forceReasoning: true } };
  return { openai: { forceReasoning: true, reasoningEffort: openAiReasoningEffortForModel(model) } };
}

export type GoogleThinkingProviderOptions = {
  google: {
    thinkingConfig: {
      thinkingLevel?: GeminiThinkingLevel;
      thinkingBudget?: number;
      includeThoughts?: boolean;
    };
  };
};

/** Maps `geminiThinkingConfigForModel` into AI SDK Google provider options. */
export function googleThinkingProviderOptionsForAiSdk(
  model: string,
  thinking?: ChatExtendedThinkingOptions | null,
): GoogleThinkingProviderOptions | undefined {
  if (thinking?.enabled === false) return undefined;
  const cfg = geminiThinkingConfigForModel(model);
  if (!cfg) return undefined;
  return {
    google: {
      thinkingConfig: {
        ...(cfg.thinkingLevel != null ? { thinkingLevel: cfg.thinkingLevel } : {}),
        ...(cfg.thinkingBudget != null ? { thinkingBudget: cfg.thinkingBudget } : {}),
        includeThoughts: cfg.includeThoughts,
      },
    },
  };
}
