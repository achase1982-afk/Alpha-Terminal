import { geminiThinkingConfigForModel } from "./geminiThinkingConfig.js";

/**
 * Central defaults for provider-native reasoning / extended thinking across the stack.
 * Anthropic: Messages API `thinking`; Vercel AI SDK `providerOptions.anthropic.thinking`.
 * xAI: `providerOptions.xai.reasoningEffort` (chat: low|high; responses: low|medium|high).
 */

/** Budget for Claude `thinking: { type: "enabled", budget_tokens }` (non-adaptive models). */
export const ANTHROPIC_EXTENDED_THINKING_BUDGET = 4096;

/**
 * Claude Opus/Sonnet 4.7+ use adaptive thinking in the Messages API.
 * Matches ids like `claude-opus-4-7`, `claude-sonnet-4-7-20250514`, etc.
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

/**
 * Vercel AI SDK `@ai-sdk/anthropic`: spread into `streamText` / `generateText`.
 * Without this, Claude runs with extended thinking disabled (plain completions).
 */
export function anthropicProviderOptionsForAiSdk(model: string):
  | {
      providerOptions: {
        anthropic: {
          thinking: { type: "adaptive" } | { type: "enabled"; budgetTokens: number };
        };
      };
    }
  | undefined {
  if (!isAnthropicExtendedThinkingCapableModel(model)) return undefined;
  if (isAnthropicAdaptiveThinkingModel(model)) {
    return { providerOptions: { anthropic: { thinking: { type: "adaptive" } } } };
  }
  return {
    providerOptions: {
      anthropic: {
        thinking: { type: "enabled", budgetTokens: ANTHROPIC_EXTENDED_THINKING_BUDGET },
      },
    },
  };
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
export function xaiReasoningProviderOptionsForChat(model: string): XaiChatReasoningProviderOptions | undefined {
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
): OpenAiChatReasoningProviderOptions | undefined {
  if (!/^gpt-5/.test(model) && !/^o\d/.test(model)) return undefined;
  const effort = /^gpt-5\.5/.test(model) ? "high" : "medium";
  return { openai: { reasoningEffort: effort } };
}

export type GoogleThinkingProviderOptions = {
  google: {
    thinkingConfig: {
      thinkingBudget?: number;
      includeThoughts?: boolean;
      thinkingLevel?: "minimal" | "low" | "medium" | "high";
    };
  };
};

/** Maps `geminiThinkingConfigForModel` into AI SDK Google provider options. */
export function googleThinkingProviderOptionsForAiSdk(
  model: string,
): GoogleThinkingProviderOptions | undefined {
  const cfg = geminiThinkingConfigForModel(model);
  if (!cfg) return undefined;
  let thinkingLevel: "minimal" | "low" | "medium" | "high" | undefined;
  if (cfg.thinkingLevel != null) {
    const raw = String(cfg.thinkingLevel).toLowerCase();
    if (raw === "minimal" || raw === "low" || raw === "medium" || raw === "high") {
      thinkingLevel = raw;
    }
  }
  return {
    google: {
      thinkingConfig: {
        thinkingBudget: cfg.thinkingBudget,
        includeThoughts: cfg.includeThoughts,
        ...(thinkingLevel ? { thinkingLevel } : {}),
      },
    },
  };
}
