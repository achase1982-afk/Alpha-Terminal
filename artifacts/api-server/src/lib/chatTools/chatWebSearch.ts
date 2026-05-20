import {
  callAnthropicWithSystemAndWebSearch,
  callGeminiWithSystemAndWebSearch,
  callOpenAIWithSystemAndWebSearch,
} from "../aiLabAnalystClient.js";
import { hasGeminiApiKey } from "../geminiClient.js";
import { isGeminiModel, isOpenAiModel } from "../chatModel.js";

const CHAT_WEB_SEARCH_SYSTEM =
  "Search the public web using your provider's native web search. Return concise bullet facts; include source names or URLs when available. No speculation.";

export type ChatWebSearchResult = {
  provider: "anthropic" | "google" | "openai";
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
    default:
      return "Anthropic API key not configured on the server.";
  }
}

/**
 * Run web search with the same provider as the active chat model (native APIs).
 */
export async function runChatNativeWebSearch(
  activeModel: string,
  query: string,
): Promise<ChatWebSearchResult | { error: string }> {
  const model = activeModel.trim() || "claude-opus-4-7";
  const signal = AbortSignal.timeout(24_000);

  try {
    if (isGeminiModel(model)) {
      if (!hasGeminiApiKey()) {
        return { error: missingKeyError("google") };
      }
      const ws = await callGeminiWithSystemAndWebSearch(
        model,
        0,
        CHAT_WEB_SEARCH_SYSTEM,
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
        CHAT_WEB_SEARCH_SYSTEM,
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
      CHAT_WEB_SEARCH_SYSTEM,
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
