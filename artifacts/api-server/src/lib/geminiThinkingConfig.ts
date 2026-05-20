import { ThinkingLevel } from "@google/genai";

/** Gemini 2.5+ / 3.x thinking models: dynamic budget unless Flash preview (medium thinking level). */
export function geminiThinkingConfigForModel(model: string):
  | { thinkingBudget: number; includeThoughts: boolean; thinkingLevel?: ThinkingLevel }
  | undefined {
  if (!/^gemini-(2\.5|3)/.test(model)) return undefined;
  // Gemini 3.5 Flash / 3 Flash preview: dynamic thinking budget + medium level (Google 3.x guidance).
  if (model === "gemini-3.5-flash" || model === "gemini-3-flash-preview") {
    return { thinkingBudget: -1, includeThoughts: true, thinkingLevel: ThinkingLevel.MEDIUM };
  }
  // Gemini 3.1 Pro and other 3.x: thinking on with dynamic budget.
  return { thinkingBudget: -1, includeThoughts: true };
}
