import {
  augmentPromptWithDedicatedWebSearch,
  executeDedicatedWebSearch,
  extractWebSearchQueryFromPrompt,
  formatDedicatedWebSearchContextBlock,
  isDedicatedWebSearchApiEnabled,
  type DedicatedWebSearchResult,
} from "./webSearchApiClient.js";
import type { WebSearchEnvelope, WebSearchResult } from "./aiLabAnalystClient.js";

export { isDedicatedWebSearchApiEnabled };

type WebSearchLlmProvider = "anthropic" | "google" | "openai" | "xai";

async function synthesizeWithProvider(opts: {
  provider: WebSearchLlmProvider;
  model: string;
  temperature: number;
  systemPrompt: string;
  prompt: string;
  cancelSignal?: AbortSignal;
}): Promise<{ text: string; envelope: WebSearchEnvelope }> {
  const { provider, model, temperature, systemPrompt, prompt, cancelSignal } = opts;
  const mod = await import("./aiLabAnalystClient.js");

  switch (provider) {
    case "anthropic": {
      const text = await mod.callAnthropicWithSystem(model, temperature, systemPrompt, prompt, cancelSignal);
      return { text, envelope: mod.createEmptyEnvelope("anthropic", model) };
    }
    case "google": {
      const text = await mod.callGeminiWithSystem(model, temperature, systemPrompt, prompt, cancelSignal);
      return { text, envelope: mod.createEmptyEnvelope("gemini", model) };
    }
    case "openai": {
      const text = await mod.callOpenAIStrategistWithSystem(
        model,
        temperature,
        systemPrompt,
        prompt,
        cancelSignal,
      );
      return { text, envelope: mod.createEmptyEnvelope("openai", model) };
    }
    case "xai": {
      const text = await mod.callXaiWithSystem(model, temperature, systemPrompt, prompt, cancelSignal);
      return { text, envelope: mod.createEmptyEnvelope("xai", model) };
    }
    default:
      throw new Error(`Unsupported provider for dedicated web search synthesis: ${provider}`);
  }
}

function mergeDedicatedTrace(
  search: DedicatedWebSearchResult,
  usedInSynthesis: boolean,
): WebSearchResult["trace"] {
  return {
    ...search.trace,
    webSearchUsed: search.trace.webSearchUsed || usedInSynthesis,
    searchBackend: "dedicated_api",
    dedicatedApiEndpoint: search.endpointUsed,
  };
}

/**
 * Dedicated Web Search API + LLM synthesis (no provider-native search tools).
 */
export async function callViaDedicatedWebSearchApi(opts: {
  provider: WebSearchLlmProvider;
  model: string;
  temperature: number;
  systemPrompt: string;
  prompt: string;
  cancelSignal?: AbortSignal;
  /** Override query extraction (e.g. chat passes the tool query directly). */
  searchQuery?: string;
}): Promise<WebSearchResult> {
  const query = (opts.searchQuery ?? extractWebSearchQueryFromPrompt(opts.prompt)).trim();
  const search = await executeDedicatedWebSearch(query, opts.cancelSignal);
  const block = formatDedicatedWebSearchContextBlock(search);
  const augmentedPrompt = augmentPromptWithDedicatedWebSearch(opts.prompt, block);

  const { text, envelope } = await synthesizeWithProvider({
    provider: opts.provider,
    model: opts.model,
    temperature: opts.temperature,
    systemPrompt: opts.systemPrompt,
    prompt: augmentedPrompt,
    cancelSignal: opts.cancelSignal,
  });

  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("No text content in LLM response after dedicated web search");
  }

  return {
    text: trimmed,
    trace: mergeDedicatedTrace(search, true),
    envelope,
  };
}

/**
 * Stream entry point: runs Web Search API first, then synthesizes via LLM (single delta batch).
 * Token streaming for the synthesis step can be added later without changing call sites.
 */
export async function streamCallViaDedicatedWebSearchApi(opts: {
  provider: WebSearchLlmProvider;
  model: string;
  temperature: number;
  systemPrompt: string;
  prompt: string;
  onDelta: (text: string) => void;
  onStatus?: (status: string) => void;
  cancelSignal?: AbortSignal;
  searchQuery?: string;
}): Promise<WebSearchResult> {
  opts.onStatus?.("Searching the web (Web Search API)…");
  const result = await callViaDedicatedWebSearchApi({
    provider: opts.provider,
    model: opts.model,
    temperature: opts.temperature,
    systemPrompt: opts.systemPrompt,
    prompt: opts.prompt,
    cancelSignal: opts.cancelSignal,
    searchQuery: opts.searchQuery,
  });
  if (result.text) {
    opts.onDelta(result.text);
  }
  opts.onStatus?.("Web search complete");
  return result;
}
