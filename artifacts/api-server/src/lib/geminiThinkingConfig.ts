import { ThinkingLevel } from "@google/genai";

/** Gemini 2.5+ / 3.x thinking models. API allows only one of thinkingBudget or thinkingLevel. */
export type GeminiThinkingConfig =
  | { includeThoughts: boolean; thinkingBudget: number }
  | { includeThoughts: boolean; thinkingLevel: ThinkingLevel };

export function geminiThinkingConfigForModel(model: string): GeminiThinkingConfig | undefined {
  if (!/^gemini-(2\.5|3)/.test(model)) return undefined;
  // Gemini 3.5 Flash / 3 Flash preview: thinking level only (cannot combine with budget).
  if (model === "gemini-3.5-flash" || model === "gemini-3-flash-preview") {
    return { includeThoughts: true, thinkingLevel: ThinkingLevel.MEDIUM };
  }
  // Gemini 3.1 Pro and other 3.x: dynamic thinking budget.
  return { thinkingBudget: -1, includeThoughts: true };
}
