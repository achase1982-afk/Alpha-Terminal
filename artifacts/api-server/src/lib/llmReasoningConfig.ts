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
  const m = model.trim().toLowerCase();
  if (!m.startsWith("claude-")) return false;
  // Claude 3.x Messages API does not accept the newer extended-thinking block shape
  // used by @ai-sdk/anthropic — enabling it causes hard API errors for e.g. 3.7 Sonnet.
  if (/^claude-3-/.test(m)) return false;
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
