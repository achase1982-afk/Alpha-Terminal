import {
  callAnthropicWithSystemAndWebSearch,
  callGeminiWithSystemAndWebSearch,
  callOpenAIWithSystemAndWebSearch,
} from "../aiLabAnalystClient.js";
import { hasGeminiApiKey } from "../geminiClient.js";
import { isGeminiModel, isOpenAiModel } from "../chatModel.js";
import {
  executeDedicatedWebSearch,
  formatDedicatedWebSearchForChat,
  isDedicatedWebSearchApiEnabled,
} from "../webSearchApiClient.js";

const CHAT_WEB_SEARCH_SYSTEM_NATIVE =
  "Search the public web. Return concise bullet facts (catalyst, numbers, dates). Omit publisher names and URLs unless essential. No speculation. Facts are for internal synthesis only.";

export type ChatWebSearchResult = {
  provider: "anthropic" | "google" | "openai" | "web_search_api";
  model: string;
  text: string;
  sources: Array<{ title: string; url: string; date?: string }>;
};

function missingKeyError(provider: ChatWebSearchResult["provider"]): string {
  switch (provider) {
    case "google":
      return "Gemini API key not configured on the server.";
    case "openai":
      return "OpenAI API key not configured on the server.";
    case "web_search_api":
      return "TAVILY_API_KEY not configured on the server.";
    default:
      return "Anthropic API key not configured on the server.";
  }
}

async function runDedicatedApiChatSearch(
  query: string,
  activeModel: string,
  signal: AbortSignal,
): Promise<ChatWebSearchResult | { error: string }> {
  if (!isDedicatedWebSearchApiEnabled()) {
    return { error: missingKeyError("web_search_api") };
  }
  try {
    const search = await executeDedicatedWebSearch(query, signal);
    const text = formatDedicatedWebSearchForChat(search).trim().slice(0, 12_000);
    return {
      provider: "web_search_api",
      model: activeModel,
      text,
      sources: search.trace.sources.slice(0, 18),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

/**
 * Run web search via the dedicated Web Search API when configured; otherwise use
 * the active chat model provider's native search.
 */
export async function runChatNativeWebSearch(
  activeModel: string,
  query: string,
): Promise<ChatWebSearchResult | { error: string }> {
  const model = activeModel.trim() || "claude-opus-4-8";
  const signal = AbortSignal.timeout(24_000);

  if (isDedicatedWebSearchApiEnabled()) {
    return runDedicatedApiChatSearch(query, model, signal);
  }

  try {
    if (isGeminiModel(model)) {
      if (!hasGeminiApiKey()) {
        return { error: missingKeyError("google") };
      }
      const ws = await callGeminiWithSystemAndWebSearch(
        model,
        0,
        CHAT_WEB_SEARCH_SYSTEM_NATIVE,
        query,
        signal,
      );
      return {
        provider: "google",
        model,
        text: ws.text.trim().slice(0, 12_000),
        sources: ws.trace.sources.slice(0, 18),
      };
    }

    if (isOpenAiModel(model)) {
      if (!(process.env.OPENAI_API_KEY ?? "").trim()) {
        return { error: missingKeyError("openai") };
      }
      const ws = await callOpenAIWithSystemAndWebSearch(
        model,
        0,
        CHAT_WEB_SEARCH_SYSTEM_NATIVE,
        query,
        signal,
      );
      return {
        provider: "openai",
        model,
        text: ws.text.trim().slice(0, 12_000),
        sources: ws.trace.sources.slice(0, 18),
      };
    }

    if (!(process.env.ANTHROPIC_API_KEY ?? "").trim()) {
      return { error: missingKeyError("anthropic") };
    }
    const ws = await callAnthropicWithSystemAndWebSearch(
      model,
      0,
      CHAT_WEB_SEARCH_SYSTEM_NATIVE,
      query,
      signal,
    );
    return {
      provider: "anthropic",
      model,
      text: ws.text.trim().slice(0, 12_000),
      sources: ws.trace.sources.slice(0, 18),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}
