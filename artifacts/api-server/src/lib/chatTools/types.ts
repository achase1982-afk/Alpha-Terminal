import type { AnthropicOpusEffort } from "@workspace/ai-models";

export type ChatToolContext = {
  userId: string;
  schwabAccessToken?: string | null;
  /** Chat model id for this turn — `web_search` uses TAVILY_API_KEY / SERPER_API_KEY when set, else provider-native search. */
  activeModel: string;
  /** Opus 4.7+ effort for native Anthropic web search tool calls. */
  anthropicOpusEffort?: AnthropicOpusEffort | null;
};
