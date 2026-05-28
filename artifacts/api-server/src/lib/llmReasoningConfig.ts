import type Anthropic from "@anthropic-ai/sdk";
import {
  type AnthropicOpusCallOptions,
  type AnthropicOpusEffort,
  type AnthropicOpusSpeed,
  DEFAULT_ANTHROPIC_OPUS_EFFORT,
  DEFAULT_ANTHROPIC_OPUS_SPEED,
  isAnthropicOpusEffortModel,
  normalizeAnthropicOpusEffort,
  normalizeAnthropicOpusSpeed,
} from "@workspace/ai-models";
import { geminiThinkingConfigForModel } from "./geminiThinkingConfig.js";

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
 * Claude Opus/Sonnet 4.7+ use adaptive thinking in the Messages API.
 * Matches ids like `claude-opus-4-8`, `claude-opus-4-7`, `claude-sonnet-4-7-20250514`, etc.
 */
export function isAnthropicAdaptiveThinkingModel(model: string): boolean {
  return /^claude-(opus|sonnet)-4-([7-9]|\d{2,})(?:[-._]|$)/.test(model);
}

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
  if (resolvedSpeed === "fast") {
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
    ...(resolvedSpeed === "fast" ? { speed: "fast" as const } : {}),
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
  openai: { reasoningEffort: "minimal" | "low" | "medium" | "high" };
};

/** GPT-5.x chat/reasoning via AI SDK `providerOptions.openai.reasoningEffort`. */
export function openAiReasoningProviderOptionsForChat(
  model: string,
  thinking?: ChatExtendedThinkingOptions | null,
): OpenAiChatReasoningProviderOptions | undefined {
  if (thinking?.enabled === false) return undefined;
  if (!/^gpt-5/.test(model) && !/^o\d/.test(model)) return undefined;
  const effort = /^gpt-5\.5/.test(model) ? "high" : "medium";
  return { openai: { reasoningEffort: effort } };
}

export type GoogleThinkingProviderOptions = {
  google: {
    thinkingConfig: {
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
        thinkingBudget: cfg.thinkingBudget,
        includeThoughts: cfg.includeThoughts,
      },
    },
  };
}
