import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import type { LanguageModel } from "ai";
import { getGeminiApiKey } from "./geminiClient.js";
import { getXaiApiKey } from "./xaiEnv.js";
import {
  anthropicProviderOptionsForAiSdk,
  xaiReasoningProviderOptionsForChat,
} from "./llmReasoningConfig.js";

export function isGeminiModel(model: string): boolean {
  return model.startsWith("gemini-");
}

export function isGrokModel(model: string): boolean {
  return model.startsWith("grok-");
}

export function isOpenAiModel(model: string): boolean {
  return model.startsWith("gpt-") || /^o\d/.test(model);
}

export type ResolvedChatModel =
  | { model: LanguageModel; temperature: number }
  | {
      model: LanguageModel;
      providerOptions: NonNullable<ReturnType<typeof anthropicProviderOptionsForAiSdk>>;
    }
  | {
      model: LanguageModel;
      temperature: number;
      providerOptions: NonNullable<ReturnType<typeof xaiReasoningProviderOptionsForChat>>;
    };

/** Resolve AI SDK language model for chat `streamText`. */
export function resolveChatLanguageModel(modelId: string): ResolvedChatModel {
  if (isGeminiModel(modelId)) {
    const apiKey = getGeminiApiKey();
    if (!apiKey) throw new Error("Gemini API key not configured.");
    const google = createGoogleGenerativeAI({ apiKey });
    return { model: google(modelId), temperature: 0 };
  }
  if (isGrokModel(modelId)) {
    const apiKey = getXaiApiKey();
    if (!apiKey) throw new Error("xAI API key not configured.");
    const xai = createXai({ apiKey });
    const reasoning = xaiReasoningProviderOptionsForChat(modelId);
    return {
      model: xai(modelId),
      temperature: 0,
      ...(reasoning ? { providerOptions: reasoning } : {}),
    };
  }
  if (isOpenAiModel(modelId)) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OpenAI API key not configured.");
    const openai = createOpenAI({ apiKey });
    return { model: openai(modelId), temperature: 0 };
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Claude API key not configured.");
  const anthropic = createAnthropic({ apiKey });
  const thinking = anthropicProviderOptionsForAiSdk(modelId);
  if (thinking) {
    return { model: anthropic(modelId), providerOptions: thinking };
  }
  return { model: anthropic(modelId), temperature: 0 };
}

/** xAI Grok tool streaming can be flaky on some SDK builds — documented in chat route status SSE. */
export const XAI_CHAT_TOOLS_NOTE =
  "xAI Grok tool streaming uses the standard AI SDK path; if tool events fail, text-only fallback may apply.";
