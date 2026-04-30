import { ThinkingLevel } from "@google/genai";

/** Gemini 2.5+ / 3.x thinking models: dynamic budget unless Flash preview (medium thinking level). */
export function geminiThinkingConfigForModel(model: string):
  | { thinkingBudget: number; includeThoughts: boolean; thinkingLevel?: ThinkingLevel }
  | undefined {
  if (!/^gemini-(2\.5|3)/.test(model)) return undefined;
  if (model === "gemini-3-flash-preview") {
    return { thinkingBudget: -1, includeThoughts: false, thinkingLevel: ThinkingLevel.MEDIUM };
  }
  return { thinkingBudget: -1, includeThoughts: false };
}
