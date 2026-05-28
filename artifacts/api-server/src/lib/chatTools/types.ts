import type { AnthropicOpusCallOptions } from "@workspace/ai-models";

export type ChatToolContext = {
  userId: string;
  schwabAccessToken?: string | null;
  /** Chat model id for this turn — `web_search` uses TAVILY_API_KEY / SERPER_API_KEY when set, else provider-native search. */
  activeModel: string;
  /** Opus 4.7+ effort and fast mode for native Anthropic web search tool calls. */
  anthropicOpusOptions?: AnthropicOpusCallOptions | null;
  /** Provider extended thinking / reasoning for this turn (default on). */
  extendedThinkingEnabled?: boolean;
};
