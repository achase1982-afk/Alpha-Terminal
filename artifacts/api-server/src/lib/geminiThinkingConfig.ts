export type GeminiThinkingLevel = "low" | "medium" | "high";

export type GeminiThinkingConfig = {
  /** Gemini 3.x: `thinking_level` replaces the deprecated `thinking_budget` (never send both). */
  thinkingLevel?: GeminiThinkingLevel;
  /** Gemini 2.5: dynamic budget (-1). */
  thinkingBudget?: number;
  includeThoughts: boolean;
};

/**
 * Thinking config for Gemini thinking models.
 * - Gemini 3.x (3.8 Flash, 3.1 Pro, …): `thinkingLevel: "high"` with thought summaries.
 * - Gemini 2.5: dynamic `thinkingBudget: -1` with thought summaries.
 */
export function geminiThinkingConfigForModel(model: string): GeminiThinkingConfig | undefined {
  if (/^gemini-3/.test(model)) {
    return { thinkingLevel: "high", includeThoughts: true };
  }
  if (/^gemini-2\.5/.test(model)) {
    return { thinkingBudget: -1, includeThoughts: true };
  }
  return undefined;
}
